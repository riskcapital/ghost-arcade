import Foundation
import simd
@main struct ScanCoreTests {
    static func main() throws {
        let center = scanWorldPoint(x: 2, y: 2, depth: 2, fx: 2, fy: 2, cx: 2, cy: 2, transform: matrix_identity_float4x4)
        precondition(center == SIMD3<Float>(0, 0, -2), "Depth must point forward along ARKit -Z")
        var translated = matrix_identity_float4x4; translated.columns.3 = SIMD4<Float>(1, 2, 3, 1)
        let corner = scanWorldPoint(x: 3, y: 3, depth: 2, fx: 2, fy: 2, cx: 2, cy: 2, transform: translated)
        precondition(corner == SIMD3<Float>(2, 1, 1), "Image +Y must unproject to world -Y before camera transform")
        let red = ScanPoint(position: center, color: SIMD3(255, 0, 0), depth: 2)
        let blue = ScanPoint(position: corner, color: SIMD3(0, 128, 255), depth: 2)
        var acc = ScanAccumulator(spacing: 0.01, limit: 2)
        acc.insert(red); acc.insert(red); precondition(acc.count == 1, "Repeated surface samples must deduplicate")
        acc.insert(blue); acc.insert(ScanPoint(position: SIMD3(20, 20, 20), color: .zero, depth: 3)); precondition(acc.count == 2, "Capture memory must be bounded")
        acc.insert(ScanPoint(position: SIMD3(Float.nan, 0, 0), color: .zero, depth: 1)); precondition(acc.count == 2)
        acc.clear(); precondition(acc.count == 0)
        let a = ScanPoint(position: SIMD3<Float>(0.001, 0, 0), color: SIMD3<UInt8>(0, 0, 0), depth: 1)
        let b = ScanPoint(position: SIMD3<Float>(0.003, 0, 0), color: SIMD3<UInt8>(100, 200, 100), depth: 1.2)
        acc.insert(a); acc.insert(b)
        precondition(acc.count == 1 && abs(acc.points[0].position.x - 0.002) < 0.00001, "Fuse repeated observations instead of accumulating noisy duplicates")
        precondition(acc.points[0].color == SIMD3<UInt8>(50, 100, 50), "Fuse original colors")
        let data = encodeScanPLY([red, blue]); try data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
        // Exercise disk-backed exports above the desktop render budget without keeping all positions in memory.
        let archive = ScanArchive()
        var batch = ScanAccumulator(spacing: 0.003, limit: 200_000)
        for chunk in 0..<8 {
            for j in 0..<200_000 {
                let n = chunk * 200_000 + j
                batch.insert(ScanPoint(position: SIMD3<Float>(Float(n % 10_000) * 0.004, Float(n / 10_000) * 0.004, -1), color: SIMD3(10, 100, 240), depth: 1))
            }
            try archive.flush(&batch)
        }
        precondition(archive.count == 1_600_000 && archive.preview.count <= 40_000 && batch.count == 0)
        let large = URL(fileURLWithPath: CommandLine.arguments[1] + ".large.ply")
        _ = try writeScanPLY(points: [red, blue], chunks: archive.chunks, archivedCount: archive.count, to: large)
        let files = archive.chunks; archive.clear()
        precondition(files.allSatisfy { !FileManager.default.fileExists(atPath: $0.path) })
        print("PASS disk-backed 1,600,002-point export; bounded preview; temporary archive cleanup")
        print("PASS LiDAR coordinate transform, voxel fusion, memory cap, nonfinite rejection and native PLY export")
    }
}
