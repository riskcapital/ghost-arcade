import Foundation
import simd

struct ScanPoint {
    var position: SIMD3<Float>
    var color: SIMD3<UInt8>
    var depth: Float
    var observations: Float = 1
}
struct ScanVoxel: Hashable { let x:Int32; let y:Int32; let z:Int32 }
struct ScanAccumulator {
    let spacing:Float
    let limit:Int
    private(set) var voxels:[ScanVoxel:ScanPoint]=[:]
    var points:[ScanPoint] { Array(voxels.values) }
    var count:Int { voxels.count }
    mutating func clear(){voxels.removeAll(keepingCapacity:true)}
    func key(for p: SIMD3<Float>) -> ScanVoxel? {
        guard spacing.isFinite, spacing >= 0.0001, limit > 0, p.x.isFinite, p.y.isFinite, p.z.isFinite, abs(p.x) < 1000, abs(p.y) < 1000, abs(p.z) < 1000 else { return nil }
        return ScanVoxel(x: Int32(floor(p.x / spacing)), y: Int32(floor(p.y / spacing)), z: Int32(floor(p.z / spacing)))
    }
    mutating func insert(_ point:ScanPoint){
        guard let key = key(for: point.position) else { return }
        if var old = voxels[key] {
            let weight = min(old.observations, 15), total = weight + 1
            old.position = (old.position * weight + point.position) / total
            old.depth = (old.depth * weight + point.depth) / total
            for channel in 0..<3 { old.color[channel] = UInt8((Float(old.color[channel]) * weight + Float(point.color[channel])) / total) }
            old.observations = total; voxels[key] = old
        } else if voxels.count < limit { voxels[key] = point }
    }
}
func scanWorldPoint(x:Float,y:Float,depth:Float,fx:Float,fy:Float,cx:Float,cy:Float,transform:simd_float4x4)->SIMD3<Float>{
    let p=transform*SIMD4<Float>((x-cx)*depth/fx,-(y-cy)*depth/fy,-depth,1)
    return SIMD3(p.x,p.y,p.z)
}
// Standard colored PLY; meters, right-handed, Y up. No Gaussian-splat fields.
func scanPLYHeader(count: Int) -> Data {
    let header="ply\nformat binary_little_endian 1.0\ncomment Ghost Arcade LiDAR; units meters; Y up\nelement vertex \(count)\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
    return Data(header.utf8)
}
func encodeScanPLYBody(_ points: [ScanPoint]) -> Data {
    var data = Data(); data.reserveCapacity(points.count * 15)
    for p in points {
        for value in [p.position.x,p.position.y,p.position.z] {var bits=value.bitPattern.littleEndian;withUnsafeBytes(of:&bits){data.append(contentsOf:$0)}}
        data.append(contentsOf:[p.color.x,p.color.y,p.color.z])
    }
    return data
}

func encodeScanPLY(_ points: [ScanPoint]) -> Data {
    var data = scanPLYHeader(count: points.count); data.append(encodeScanPLYBody(points)); return data
}

/// Fine scans spool point bodies to disk, keeping only voxel keys and a small preview in RAM.
final class ScanArchive {
    private var folder: URL?
    private(set) var chunks: [URL] = []
    private(set) var keys = Set<ScanVoxel>()
    private(set) var preview: [ScanPoint] = []
    private(set) var count = 0
    func flush(_ accumulator: inout ScanAccumulator) throws {
        guard accumulator.count > 0 else { return }
        let spool: URL
        if let folder = folder { spool = folder } else {
            spool = FileManager.default.temporaryDirectory.appendingPathComponent("ghost-scan-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: spool, withIntermediateDirectories: true); folder = spool
        }
        let file = spool.appendingPathComponent("chunk-\(chunks.count).bin")
        let points = accumulator.points
        try encodeScanPLYBody(points).write(to: file, options: .atomic)
        chunks.append(file); count += points.count; keys.formUnion(accumulator.voxels.keys)
        let step = max(1, Int(ceil(Double(points.count) / 20_000)))
        preview.append(contentsOf: stride(from: 0, to: points.count, by: step).map { points[$0] })
        if preview.count > 40_000 { preview = preview.enumerated().compactMap { $0.offset % 2 == 0 ? $0.element : nil } }
        accumulator.clear()
    }
    func clear() {
        if let folder = folder { try? FileManager.default.removeItem(at: folder) }
        folder = nil; chunks = []; keys.removeAll(); preview = []; count = 0
    }
    deinit { clear() }
}
func writeScanPLY(points: [ScanPoint], chunks: [URL], archivedCount: Int, to file: URL) throws -> Int {
    guard FileManager.default.createFile(atPath: file.path, contents: nil) else { throw NSError(domain: "ScanExport", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not create scan file."]) }
    let out = try FileHandle(forWritingTo: file); defer { try? out.close() }
    let header = scanPLYHeader(count: archivedCount + points.count); try out.write(contentsOf: header)
    var archivedBytes = 0
    for chunk in chunks {
        let data = try Data(contentsOf: chunk)
        try out.write(contentsOf: data); archivedBytes += data.count
    }
    guard archivedBytes == archivedCount * 15 else { throw NSError(domain: "ScanExport", code: 2, userInfo: [NSLocalizedDescriptionKey: "The scan archive is incomplete."]) }
    try out.write(contentsOf: encodeScanPLYBody(points)); try out.synchronize()
    return header.count + (archivedCount + points.count) * 15
}
