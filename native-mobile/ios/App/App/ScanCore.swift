import Foundation
import simd

// Pure scan pipeline: depth frames + intrinsics + poses in, a clean point cloud out.
// No ARKit or UIKit here, so it is unit-tested on the Mac (native-mobile/ios/App/ScanCoreTests).
//
// Output is shaped for the desktop Point Cloud layer, which recentres on the bounding box,
// scales the largest side to 4 units, looks from +Z with Y up, and thins by fixed stride over
// file order. So the cloud must be free of stray points, upright, facing +Z, evenly dense,
// within the desktop point budgets, and stored in a spatially unbiased order.

/// Detail presets. Point limits match the desktop budgets: 250k stays inside the depth-sort and
/// shadow budgets, 500k is the Point Cloud FX limit, 1.5M is the Point Cloud layer limit.
struct ScanPreset: Equatable {
    let name: String
    let voxel: Float
    let maxPoints: Int
    static let performance = ScanPreset(name: "performance", voxel: 0.012, maxPoints: 250_000)
    static let balanced = ScanPreset(name: "balanced", voxel: 0.008, maxPoints: 500_000)
    static let detail = ScanPreset(name: "detail", voxel: 0.005, maxPoints: 1_500_000)
    static let all = [performance, balanced, detail]
}

/// One depth frame. `rgb` holds one colour per depth pixel (width * height * 3 bytes).
/// Intrinsics are in depth-map pixels. `transform` is camera to world (x right, y up, z back).
struct ScanFrame {
    let width: Int
    let height: Int
    let depth: UnsafePointer<Float>
    let depthRow: Int
    let confidence: UnsafePointer<UInt8>?
    let confidenceRow: Int
    let rgb: UnsafePointer<UInt8>
    let fx: Float, fy: Float, cx: Float, cy: Float
    let transform: simd_float4x4
}

struct ScanFrameStats: Equatable {
    var considered = 0, valid = 0, tooNear = 0, tooFar = 0, lowConfidence = 0, edges = 0
    var added = 0, merged = 0
    var gain: Float = 1
    var coarsened = false
    var newFraction: Float { valid > 0 ? Float(added) / Float(valid) : 0 }
}

enum ScanLook: Int { case color, coverage, depth, neon, dissolve }

struct ScanPreview {
    var positions = Data()   // float32 xyz
    var colors = Data()      // float32 rgba
    var count = 0
    var center = SIMD3<Float>(repeating: 0)
}

struct ScanFinalizeOptions {
    var minFrames = 2
    var removeOutliers = true
    var autoCrop = false
    var alignWalls = true
    var faceViewer = true
    var recentre = true
}

struct ScanResult {
    var positions: [SIMD3<Float>] = []
    var colors: [SIMD3<UInt8>] = []
    var boundsMin = SIMD3<Float>(repeating: 0)
    var boundsMax = SIMD3<Float>(repeating: 0)
    var voxel: Float = 0
    /// Rotation about +Y (radians) then translation that took ARKit world to file coordinates.
    var yaw: Float = 0
    var translation = SIMD3<Float>(repeating: 0)
    var captured = 0, droppedWeak = 0, droppedOutliers = 0, droppedCrop = 0
    var wallAligned = false, cropped = false
    var count: Int { positions.count }
}

func scanWorldPoint(x: Float, y: Float, depth: Float, fx: Float, fy: Float, cx: Float, cy: Float, transform: simd_float4x4) -> SIMD3<Float> {
    let p = transform * SIMD4<Float>((x - cx) * depth / fx, -(y - cy) * depth / fy, -depth, 1)
    return SIMD3(p.x, p.y, p.z)
}

/// Camera YCbCr to 8-bit RGB. ARKit frames are BT.601 or BT.709, full or video range.
@inline(__always)
func scanRGB(y: Float, cb: Float, cr: Float, videoRange: Bool, bt709: Bool) -> SIMD3<UInt8> {
    let l = videoRange ? (y - 16) * (255 / 219.0) : y
    let u = (cb - 128) * (videoRange ? 255 / 224.0 : 1), v = (cr - 128) * (videoRange ? 255 / 224.0 : 1)
    let rgb = bt709
        ? SIMD3<Float>(l + 1.5748 * v, l - 0.1873 * u - 0.4681 * v, l + 1.8556 * u)
        : SIMD3<Float>(l + 1.402 * v, l - 0.344136 * u - 0.714136 * v, l + 1.772 * u)
    let c = simd_clamp(rgb + 0.5, SIMD3<Float>(repeating: 0), SIMD3<Float>(repeating: 255))
    return SIMD3(UInt8(c.x), UInt8(c.y), UInt8(c.z))
}

/// Open-addressing map from a packed cell key to an index. Much faster than Dictionary here.
struct ScanCellTable {
    private var keys: [UInt64]
    private var values: [Int32]
    private var mask: Int
    private(set) var count = 0
    private static let empty = UInt64.max
    init(capacity: Int = 1 << 12) {
        var size = 1 << 10
        while size < capacity * 2 { size <<= 1 }
        keys = [UInt64](repeating: Self.empty, count: size); values = [Int32](repeating: -1, count: size); mask = size - 1
    }
    @inline(__always) private func slot(_ key: UInt64) -> Int { Int(truncatingIfNeeded: (key &* 0x9E37_79B9_7F4A_7C15) >> 20) & mask }
    @inline(__always) func find(_ key: UInt64) -> Int32 {
        var i = slot(key)
        while true {
            let k = keys[i]
            if k == key { return values[i] }
            if k == Self.empty { return -1 }
            i = (i + 1) & mask
        }
    }
    mutating func set(_ key: UInt64, _ value: Int32) {
        if (count + 1) * 2 > keys.count { grow() }
        var i = slot(key)
        while keys[i] != Self.empty && keys[i] != key { i = (i + 1) & mask }
        if keys[i] == Self.empty { count += 1 }
        keys[i] = key; values[i] = value
    }
    private mutating func grow() {
        let oldKeys = keys, oldValues = values
        keys = [UInt64](repeating: Self.empty, count: oldKeys.count * 2); values = [Int32](repeating: -1, count: oldKeys.count * 2)
        mask = keys.count - 1; count = 0
        for i in 0..<oldKeys.count where oldKeys[i] != Self.empty { set(oldKeys[i], oldValues[i]) }
    }
    func forEach(_ body: (UInt64, Int32) -> Void) { for i in 0..<keys.count where keys[i] != Self.empty { body(keys[i], values[i]) } }
}

/// Packs a cell coordinate into 63 bits (21 per axis). Nil outside +-1,048,575 cells or for bad input.
@inline(__always)
func scanCellKey(_ p: SIMD3<Float>, size: Float) -> UInt64? {
    let c = (p / size).rounded(.down)
    guard c.x.isFinite, c.y.isFinite, c.z.isFinite, abs(c.x) < 1_048_575, abs(c.y) < 1_048_575, abs(c.z) < 1_048_575 else { return nil }
    return scanPackCell(Int(c.x), Int(c.y), Int(c.z))
}
@inline(__always) func scanPackCell(_ x: Int, _ y: Int, _ z: Int) -> UInt64 {
    UInt64(x + 1_048_576) | (UInt64(y + 1_048_576) << 21) | (UInt64(z + 1_048_576) << 42)
}
@inline(__always) func scanUnpackCell(_ key: UInt64) -> (Int, Int, Int) {
    (Int(key & 0x1F_FFFF) - 1_048_576, Int((key >> 21) & 0x1F_FFFF) - 1_048_576, Int((key >> 42) & 0x1F_FFFF) - 1_048_576)
}

/// Where the camera was for each merged frame; used to orient and crop the result.
struct ScanCameraSample { var position: SIMD3<Float>; var forward: SIMD3<Float>; var focus: SIMD3<Float>? }

/// Merges depth frames into one evenly dense cloud: one running-average point per voxel.
final class ScanAccumulator {
    private(set) var voxel: Float
    let preset: ScanPreset
    var minDepth: Float = 0.25
    var maxDepth: Float = 3
    private var table = ScanCellTable()
    private var position: [SIMD3<Float>] = []
    private var color: [SIMD3<Float>] = []
    private var weight: [Float] = []
    private var frames: [UInt16] = []
    private var lastFrame: [UInt32] = []
    private var sweepOf: [UInt16] = []
    private(set) var frameCount: UInt32 = 0
    private(set) var sweep: UInt16 = 0
    private(set) var cameras: [ScanCameraSample] = []
    private var sweepCameraStart: [Int] = [0]
    var count: Int { position.count }
    /// True when the last sweep added points that can be removed again.
    var canUndo: Bool { sweepOf.contains(sweep) }

    init(preset: ScanPreset) { self.preset = preset; voxel = preset.voxel }

    func clear() {
        table = ScanCellTable(); position.removeAll(); color.removeAll(); weight.removeAll(); frames.removeAll(); lastFrame.removeAll(); sweepOf.removeAll()
        frameCount = 0; sweep = 0; cameras.removeAll(); sweepCameraStart = [0]; voxel = preset.voxel
    }
    /// Call when capture resumes after a pause. Points first seen from now on belong to the new sweep.
    func beginSweep() { guard canUndo, sweep < UInt16.max - 1 else { return }; sweep += 1; sweepCameraStart.append(cameras.count) }
    /// Removes the points first seen in the latest sweep. Returns how many were removed.
    @discardableResult func undoLastSweep() -> Int {
        let before = count, target = sweep
        keep { sweepOf[$0] != target }
        if sweepCameraStart.count > 1 { cameras.removeLast(cameras.count - sweepCameraStart.removeLast()); sweep -= 1 } else { cameras.removeAll() }
        return before - count
    }
    private func keep(_ test: (Int) -> Bool) {
        var out = 0
        for i in 0..<count where test(i) {
            if out != i { position[out] = position[i]; color[out] = color[i]; weight[out] = weight[i]; frames[out] = frames[i]; lastFrame[out] = lastFrame[i]; sweepOf[out] = sweepOf[i] }
            out += 1
        }
        let drop = count - out
        position.removeLast(drop); color.removeLast(drop); weight.removeLast(drop); frames.removeLast(drop); lastFrame.removeLast(drop); sweepOf.removeLast(drop)
        rebuildTable()
    }
    private func rebuildTable() {
        table = ScanCellTable(capacity: max(count, 1 << 12))
        for i in 0..<count { if let key = scanCellKey(position[i], size: voxel) { table.set(key, Int32(i)) } }
    }

    /// A depth step bigger than this between neighbours marks an edge or a flying pixel.
    @inline(__always) private func edgeLimit(_ z: Float, _ fx: Float) -> Float { max(0.008, 2.5 * z / fx) }

    /// Merges one frame. `step` skips depth pixels (1 = every pixel). `singleFrame` replaces the cloud each call.
    @discardableResult func integrate(_ f: ScanFrame, step: Int = 1, singleFrame: Bool = false) -> ScanFrameStats {
        if singleFrame { clear() }
        var stats = ScanFrameStats()
        frameCount &+= 1
        let step = max(1, step), w = f.width, h = f.height
        guard w >= 3, h >= 3, f.fx > 0, f.fy > 0 else { return stats }
        @inline(__always) func usable(_ x: Int, _ y: Int) -> Float? {
            let z = f.depth[y * f.depthRow + x]
            guard z.isFinite, z >= minDepth, z <= maxDepth else { return nil }
            if let c = f.confidence, c[y * f.confidenceRow + x] == 0 { return nil }
            let limit = edgeLimit(z, f.fx)
            let l = f.depth[y * f.depthRow + x - 1], r = f.depth[y * f.depthRow + x + 1], u = f.depth[(y - 1) * f.depthRow + x], d = f.depth[(y + 1) * f.depthRow + x]
            // NaN neighbours fail the comparison, so holes also count as edges.
            guard abs(l - z) <= limit, abs(r - z) <= limit, abs(u - z) <= limit, abs(d - z) <= limit else { return nil }
            return z
        }
        // Exposure: match this frame's brightness to what is already stored where they overlap.
        var oldLuma: Float = 0, newLuma: Float = 0, overlap = 0
        if count > 0 {
            for y in stride(from: 1, to: h - 1, by: 4) { for x in stride(from: 1, to: w - 1, by: 4) {
                guard let z = usable(x, y) else { continue }
                let p = scanWorldPoint(x: Float(x) + 0.5, y: Float(y) + 0.5, depth: z, fx: f.fx, fy: f.fy, cx: f.cx, cy: f.cy, transform: f.transform)
                guard let key = scanCellKey(p, size: voxel) else { continue }
                let i = Int(table.find(key)); guard i >= 0, weight[i] >= 1 else { continue }
                let o = (y * w + x) * 3
                oldLuma += color[i].x * 0.299 + color[i].y * 0.587 + color[i].z * 0.114
                newLuma += Float(f.rgb[o]) * 0.299 + Float(f.rgb[o + 1]) * 0.587 + Float(f.rgb[o + 2]) * 0.114
                overlap += 1
            } }
        }
        let gain: Float = overlap >= 150 && newLuma > 1 ? min(1.7, max(0.6, oldLuma / newLuma)) : 1
        stats.gain = gain
        for y in stride(from: 1, to: h - 1, by: step) { for x in stride(from: 1, to: w - 1, by: step) {
            let z = f.depth[y * f.depthRow + x]
            guard z.isFinite, z > 0 else { continue }
            stats.considered += 1
            if z < minDepth { stats.tooNear += 1; continue }
            if z > maxDepth { stats.tooFar += 1; continue }
            let level = f.confidence?[y * f.confidenceRow + x] ?? 2
            if level == 0 { stats.lowConfidence += 1; continue }
            guard usable(x, y) != nil else { stats.edges += 1; continue }
            let p = scanWorldPoint(x: Float(x) + 0.5, y: Float(y) + 0.5, depth: z, fx: f.fx, fy: f.fy, cx: f.cx, cy: f.cy, transform: f.transform)
            guard let key = scanCellKey(p, size: voxel) else { continue }
            stats.valid += 1
            // Medium confidence counts for less; so do far readings, which are noisier.
            let wNew = (level == 1 ? 0.35 : 1) / (1 + 0.25 * z * z)
            let o = (y * w + x) * 3
            let c = simd_min(SIMD3<Float>(Float(f.rgb[o]), Float(f.rgb[o + 1]), Float(f.rgb[o + 2])) * gain, SIMD3<Float>(repeating: 255))
            var i = Int(table.find(key))
            if i < 0 {
                // Depth noise would stack several voxel layers on one surface. Before starting a new
                // voxel, look one and two voxels along the surface normal and join a layer that is already there.
                let row = y * f.depthRow + x
                let l = f.depth[row - 1], r = f.depth[row + 1], u = f.depth[row - f.depthRow], d = f.depth[row + f.depthRow]
                let across = SIMD3<Float>((Float(x) + 1.5 - f.cx) * r / f.fx - (Float(x) - 0.5 - f.cx) * l / f.fx, -(Float(y) + 0.5 - f.cy) * (r - l) / f.fy, l - r)
                let down = SIMD3<Float>((Float(x) + 0.5 - f.cx) * (d - u) / f.fx, -(Float(y) + 1.5 - f.cy) * d / f.fy + (Float(y) - 0.5 - f.cy) * u / f.fy, u - d)
                let n = simd_cross(across, down), length = simd_length(n)
                if length > 1e-12 {
                    let world = f.transform * SIMD4<Float>(n / length, 0), normal = SIMD3<Float>(world.x, world.y, world.z) * voxel
                    for s in [Float(1), -1, 2, -2] {
                        guard let other = scanCellKey(p + normal * s, size: voxel) else { continue }
                        let j = Int(table.find(other)); if j >= 0 { i = j; break }
                    }
                }
            }
            // Far away the sensor's samples are wider apart than the voxels, so the same voxel is rarely hit
            // twice. Join the nearest point within half a sample (at most 1.5 voxels) instead of scattering new ones.
            let footprint = z / f.fx
            if i < 0, footprint > voxel {
                let (cellX, cellY, cellZ) = scanUnpackCell(key)
                var nearest = min(0.5 * footprint, 1.5 * voxel); nearest *= nearest
                for dz in -1...1 { for dy in -1...1 { for dx in -1...1 {
                    let j = Int(table.find(scanPackCell(cellX + dx, cellY + dy, cellZ + dz))); guard j >= 0 else { continue }
                    let gap = simd_distance_squared(position[j], p); if gap < nearest { nearest = gap; i = j }
                } } }
            }
            if i >= 0 {
                let wOld = min(weight[i], 24), a = wNew / (wOld + wNew)
                position[i] += (p - position[i]) * a; color[i] += (c - color[i]) * a; weight[i] = wOld + wNew
                if lastFrame[i] != frameCount { lastFrame[i] = frameCount; if frames[i] < UInt16.max { frames[i] += 1 } }
                stats.merged += 1
            } else {
                table.set(key, Int32(count))
                position.append(p); color.append(c); weight.append(wNew); frames.append(1); lastFrame.append(frameCount); sweepOf.append(sweep)
                stats.added += 1
            }
        } }
        let origin = SIMD3<Float>(f.transform.columns.3.x, f.transform.columns.3.y, f.transform.columns.3.z)
        let forward = -SIMD3<Float>(f.transform.columns.2.x, f.transform.columns.2.y, f.transform.columns.2.z)
        let mid = f.depth[(h / 2) * f.depthRow + w / 2]
        cameras.append(ScanCameraSample(position: origin, forward: forward, focus: mid.isFinite && mid >= minDepth && mid <= maxDepth ? origin + forward * mid : nil))
        if cameras.count > 20_000 { cameras = cameras.enumerated().compactMap { $0.offset % 2 == 0 ? $0.element : nil }; sweepCameraStart = sweepCameraStart.map { $0 / 2 } }
        while count > preset.maxPoints { coarsen(); stats.coarsened = true }
        return stats
    }

    /// Over the point limit: widen the voxels and merge, so density stays even instead of capture stopping.
    private func coarsen() {
        voxel *= 1.25
        var next = ScanCellTable(capacity: count)
        var out = 0
        for i in 0..<count {
            guard let key = scanCellKey(position[i], size: voxel) else { continue }
            let j = Int(next.find(key))
            if j >= 0 {
                let total = weight[j] + weight[i], a = weight[i] / total
                position[j] += (position[i] - position[j]) * a; color[j] += (color[i] - color[j]) * a; weight[j] = min(total, 48)
                frames[j] = max(frames[j], frames[i]); lastFrame[j] = max(lastFrame[j], lastFrame[i]); sweepOf[j] = min(sweepOf[j], sweepOf[i])
            } else {
                next.set(key, Int32(out))
                position[out] = position[i]; color[out] = color[i]; weight[out] = weight[i]; frames[out] = frames[i]; lastFrame[out] = lastFrame[i]; sweepOf[out] = sweepOf[i]
                out += 1
            }
        }
        let drop = count - out
        position.removeLast(drop); color.removeLast(drop); weight.removeLast(drop); frames.removeLast(drop); lastFrame.removeLast(drop); sweepOf.removeLast(drop)
        table = next
    }

    /// A light copy for drawing. Thins by stride when there are more points than `maxPoints`.
    func preview(maxPoints: Int, look: ScanLook = .color, strength: Float = 0.45, eye: SIMD3<Float> = .zero) -> ScanPreview {
        var out = ScanPreview()
        guard count > 0 else { return out }
        let step = max(1, Int((Double(count) / Double(max(1, maxPoints))).rounded(.up)))
        var xyz: [Float] = [], rgba: [Float] = []
        xyz.reserveCapacity(count / step * 3 + 3); rgba.reserveCapacity(count / step * 4 + 4)
        var sum = SIMD3<Float>(repeating: 0)
        for i in stride(from: 0, to: count, by: step) {
            let p = position[i]
            var c = color[i] / 255
            switch look {
            case .color: break
            case .coverage:
                // Orange = seen once (will be dropped unless scanned again); settles to its real colour.
                let t = min(1, Float(frames[i] - 1) / 3)
                c = simd_mix(SIMD3<Float>(1, 0.42, 0.12), c, SIMD3<Float>(repeating: t))
            case .depth:
                let t = min(1, simd_distance(p, eye) / max(maxDepth, 0.1)); c = SIMD3(1 - t, 0.25 + 0.7 * sin(t * .pi), t)
            case .neon:
                let t = simd_distance(p, eye) * (2 + strength * 12); c = SIMD3(0.35 + 0.65 * sin(t) * sin(t), 0.15 + 0.7 * cos(t) * cos(t), 1)
            case .dissolve:
                // Stable spatial hash, so points do not flicker as the cloud grows.
                let hash = abs(sin(p.x * 91.7 + p.y * 37.1 + p.z * 17.3) * 43758.5453).truncatingRemainder(dividingBy: 1)
                if hash < strength * 0.94 { continue }
            }
            xyz.append(p.x); xyz.append(p.y); xyz.append(p.z)
            rgba.append(c.x); rgba.append(c.y); rgba.append(c.z); rgba.append(1)
            sum += p
        }
        out.count = xyz.count / 3
        out.center = out.count > 0 ? sum / Float(out.count) : .zero
        out.positions = xyz.withUnsafeBufferPointer { Data(buffer: $0) }; out.colors = rgba.withUnsafeBufferPointer { Data(buffer: $0) }
        return out
    }

    /// Cleans, crops, levels and recentres the cloud for export. Does not change the accumulator.
    func finalize(_ options: ScanFinalizeOptions = ScanFinalizeOptions()) -> ScanResult {
        var result = ScanResult(); result.voxel = voxel; result.captured = count
        // 1. A point seen in a single frame is most often sensor noise.
        let need = frameCount >= 4 ? UInt16(max(1, options.minFrames)) : 1
        var kept = (0..<count).filter { frames[$0] >= need }
        result.droppedWeak = count - kept.count
        // 2. Stray points and small floating clumps. They would shrink the cloud on desktop.
        if options.removeOutliers {
            let before = kept.count
            kept = scanRemoveOutliers(kept, position: position, cell: max(voxel * 4, 0.04))
            result.droppedOutliers = before - kept.count
        }
        // 3. Optional crop to the thing the camera circled.
        if options.autoCrop, var subject = scanSubject(cameras) {
            let before = kept.count
            kept = kept.filter { let d = position[$0] - subject.center; return d.x * d.x + d.z * d.z <= subject.radius * subject.radius }
            // Then pull the crop in around whatever stands on the floor, leaving a small rim of floor.
            if let tight = scanStandingSubject(kept, position: position, voxel: voxel, within: subject.radius) {
                subject = tight
                kept = kept.filter { let d = position[$0] - subject.center; return d.x * d.x + d.z * d.z <= subject.radius * subject.radius }
            }
            result.droppedCrop = before - kept.count; result.cropped = true
        }
        // 4. Turn about the vertical so the scanned side faces +Z (the desktop camera), walls square to the axes.
        var yaw = options.faceViewer ? scanViewYaw(cameras) : 0
        if options.alignWalls, let squared = scanWallYaw(kept, position: position, near: yaw) { yaw = squared; result.wallAligned = true }
        let cosY = cos(yaw), sinY = sin(yaw)
        var points = kept.map { i -> SIMD3<Float> in let p = position[i]; return SIMD3(p.x * cosY + p.z * sinY, p.y, -p.x * sinY + p.z * cosY) }
        var colors = kept.map { i -> SIMD3<UInt8> in let c = simd_clamp(color[i] + 0.5, SIMD3<Float>(repeating: 0), SIMD3<Float>(repeating: 255)); return SIMD3(UInt8(c.x), UInt8(c.y), UInt8(c.z)) }
        // 5. Shave the thin fringe beyond the 0.2 / 99.8 percentiles, so the bounding box is the subject.
        if options.removeOutliers, points.count >= 500 {
            let before = points.count
            let box = scanPercentileBox(points, margin: 2 * voxel)
            var write = 0
            for i in 0..<points.count where all(points[i] .>= box.0) && all(points[i] .<= box.1) { points[write] = points[i]; colors[write] = colors[i]; write += 1 }
            points.removeLast(before - write); colors.removeLast(before - write)
            result.droppedOutliers += before - write
        }
        guard !points.isEmpty else { return result }
        var lo = points[0], hi = points[0]
        for p in points { lo = simd_min(lo, p); hi = simd_max(hi, p) }
        // 6. Origin under the middle of the cloud, floor at y = 0. Metres are kept.
        let shift = options.recentre ? SIMD3<Float>(-(lo.x + hi.x) / 2, -lo.y, -(lo.z + hi.z) / 2) : .zero
        // 7. Deterministic shuffle: the desktop thins by fixed stride over file order.
        var seed: UInt64 = 0x6A09_E667_F3BC_C908
        for i in stride(from: points.count - 1, to: 0, by: -1) {
            seed &+= 0x9E37_79B9_7F4A_7C15
            var z = seed; z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9; z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB; z ^= z >> 31
            let j = Int(z % UInt64(i + 1))
            points.swapAt(i, j); colors.swapAt(i, j)
        }
        for i in 0..<points.count { points[i] += shift }
        result.positions = points; result.colors = colors
        result.boundsMin = lo + shift; result.boundsMax = hi + shift; result.yaw = yaw; result.translation = shift
        return result
    }
}

/// Density filter on a coarse grid: drops points whose 3x3x3 block of cells holds fewer than
/// `minBlock` points, then drops connected clumps that are tiny next to the whole cloud.
func scanRemoveOutliers(_ kept: [Int], position: [SIMD3<Float>], cell: Float, minBlock: Int = 10) -> [Int] {
    guard kept.count > minBlock else { return kept }
    var table = ScanCellTable(capacity: kept.count / 4)
    var cellKeys: [UInt64] = [], cellPoints: [Int32] = []
    var cellOf = [Int32](repeating: -1, count: kept.count)
    for (n, i) in kept.enumerated() {
        guard let key = scanCellKey(position[i], size: cell) else { continue }
        var c = table.find(key)
        if c < 0 { c = Int32(cellKeys.count); table.set(key, c); cellKeys.append(key); cellPoints.append(0) }
        cellPoints[Int(c)] += 1; cellOf[n] = c
    }
    let cells = cellKeys.count
    var dense = [Bool](repeating: false, count: cells)
    var neighbours = [[Int32]](repeating: [], count: cells)
    for c in 0..<cells {
        let (x, y, z) = scanUnpackCell(cellKeys[c])
        var total = 0
        for dz in -1...1 { for dy in -1...1 { for dx in -1...1 {
            let other = table.find(scanPackCell(x + dx, y + dy, z + dz))
            if other >= 0 { total += Int(cellPoints[Int(other)]); if Int(other) != c { neighbours[c].append(other) } }
        } } }
        dense[c] = total >= minBlock
    }
    // Connected clumps of dense cells.
    var label = [Int32](repeating: -1, count: cells), sizes: [Int] = [], stack: [Int32] = []
    for start in 0..<cells where dense[start] && label[start] < 0 {
        let id = Int32(sizes.count); var size = 0
        label[start] = id; stack.append(Int32(start))
        while let c = stack.popLast() {
            size += Int(cellPoints[Int(c)])
            for other in neighbours[Int(c)] where dense[Int(other)] && label[Int(other)] < 0 { label[Int(other)] = id; stack.append(other) }
        }
        sizes.append(size)
    }
    guard let largest = sizes.max() else { return kept }
    let floor = min(largest, max(30, Int(Double(kept.count) * 0.0005)))
    var out: [Int] = []; out.reserveCapacity(kept.count)
    for (n, i) in kept.enumerated() { let c = Int(cellOf[n]); if c >= 0, label[c] >= 0, sizes[Int(label[c])] >= floor { out.append(i) } }
    return out
}

/// The thing the camera circled: where the view lines met, and a radius that still holds it.
/// Nil unless the camera moved around a common point by at least a third of a turn.
func scanSubject(_ cameras: [ScanCameraSample]) -> (center: SIMD3<Float>, radius: Float)? {
    let focus = cameras.compactMap { $0.focus }
    guard focus.count >= 8 else { return nil }
    func median(_ v: [Float]) -> Float { let s = v.sorted(); return s[s.count / 2] }
    let center = SIMD3(median(focus.map { $0.x }), median(focus.map { $0.y }), median(focus.map { $0.z }))
    var sectors = Set<Int>(), distances: [Float] = []
    for c in cameras {
        let d = c.position - center
        distances.append(sqrt(d.x * d.x + d.z * d.z))
        sectors.insert(Int(((atan2(d.z, d.x) + .pi) / (2 * .pi) * 12).rounded(.down)) % 12)
    }
    let reach = median(distances)
    let spread = focus.map { f -> Float in let d = f - center; return sqrt(d.x * d.x + d.z * d.z) }.sorted()
    guard sectors.count >= 4, reach > 0.15, spread[spread.count / 2] < 0.6 * reach else { return nil }
    return (center, max(0.9 * reach, 1.25 * spread[min(spread.count - 1, spread.count * 9 / 10)]))
}

/// Finds the floor (the lowest well-filled height band) and what stands on it. Returns a circle
/// around the standing part plus a quarter. Nil when there is no clear floor or nothing on it.
func scanStandingSubject(_ kept: [Int], position: [SIMD3<Float>], voxel: Float, within: Float) -> (center: SIMD3<Float>, radius: Float)? {
    guard kept.count >= 1000 else { return nil }
    var low = Float.greatestFiniteMagnitude, high = -Float.greatestFiniteMagnitude
    for i in kept { low = min(low, position[i].y); high = max(high, position[i].y) }
    let band = max(0.02, voxel * 2), bands = Int((high - low) / band) + 1
    guard bands >= 4, bands < 100_000 else { return nil }
    var fill = [Int](repeating: 0, count: bands)
    for i in kept { fill[min(bands - 1, Int((position[i].y - low) / band))] += 1 }
    guard let fullest = fill.max(), let floorBand = fill.firstIndex(where: { $0 * 10 >= fullest * 3 }) else { return nil }
    let floorTop = low + Float(floorBand + 1) * band + max(0.03, voxel * 3)
    let standing = kept.filter { position[$0].y > floorTop }
    guard standing.count >= 200, standing.count * 50 >= kept.count else { return nil }
    func median(_ v: [Float]) -> Float { let s = v.sorted(); return s[s.count / 2] }
    let center = SIMD3(median(standing.map { position[$0].x }), 0, median(standing.map { position[$0].z }))
    let reach = standing.map { i -> Float in let d = position[i] - center; return sqrt(d.x * d.x + d.z * d.z) }.sorted()
    let radius = reach[min(reach.count - 1, reach.count * 98 / 100)] * 1.25 + 0.05
    return radius < within ? (center, radius) : nil
}

/// Turn about +Y that makes the average viewing direction point at -Z, so the desktop camera
/// (on +Z) sees the cloud from where it was scanned. A full orbit has no average: use the first view.
func scanViewYaw(_ cameras: [ScanCameraSample]) -> Float {
    var mean = SIMD2<Float>(repeating: 0), first: SIMD2<Float>?
    for c in cameras {
        let f = SIMD2(c.forward.x, c.forward.z), length = simd_length(f)
        guard length > 0.2 else { continue } // looking straight up or down says nothing about heading
        mean += f / length; if first == nil { first = f / length }
    }
    guard let start = first else { return 0 }
    let heading = simd_length(mean) / Float(cameras.count) >= 0.25 ? mean : start
    return atan2(heading.x, -heading.y)
}

/// Finds the turn within 45 degrees of `near` that gives the smallest footprint box, which squares
/// walls and long objects to the axes. Nil when the gain is small (round or irregular things).
func scanWallYaw(_ kept: [Int], position: [SIMD3<Float>], near: Float) -> Float? {
    guard kept.count >= 200 else { return nil }
    let step = max(1, kept.count / 20_000)
    let sample = stride(from: 0, to: kept.count, by: step).map { SIMD2(position[kept[$0]].x, position[kept[$0]].z) }
    func area(_ yaw: Float) -> Float {
        let c = cos(yaw), s = sin(yaw)
        var lo = SIMD2<Float>(repeating: .greatestFiniteMagnitude), hi = -lo
        for p in sample { let q = SIMD2(p.x * c + p.y * s, -p.x * s + p.y * c); lo = simd_min(lo, q); hi = simd_max(hi, q) }
        return (hi.x - lo.x) * (hi.y - lo.y)
    }
    let degree = Float.pi / 180, base = area(near)
    var best = near, bestArea = base
    for k in -45..<45 { let yaw = near + Float(k) * degree, a = area(yaw); if a < bestArea { bestArea = a; best = yaw } }
    let coarse = best
    for k in -9...9 { let yaw = coarse + Float(k) * 0.1 * degree, a = area(yaw); if a < bestArea { bestArea = a; best = yaw } }
    return bestArea < 0.9 * base ? best : nil
}

/// Box between the 0.2 and 99.8 percentiles on each axis, widened by 2 percent of its size plus `margin`.
func scanPercentileBox(_ points: [SIMD3<Float>], margin: Float) -> (SIMD3<Float>, SIMD3<Float>) {
    let step = max(1, points.count / 200_000)
    var lo = SIMD3<Float>(repeating: 0), hi = lo
    for axis in 0..<3 {
        let values = stride(from: 0, to: points.count, by: step).map { points[$0][axis] }.sorted()
        let a = values[Int(Float(values.count - 1) * 0.002)], b = values[Int(Float(values.count - 1) * 0.998)]
        let pad = (b - a) * 0.02 + margin
        lo[axis] = a - pad; hi[axis] = b + pad
    }
    return (lo, hi)
}

// MARK: PLY

/// Binary little-endian PLY: float x y z, uchar red green blue. This is the layout the desktop
/// loader reads on its fast path. No normals (the desktop lights points as sprites), and no
/// scale_/rot_ fields (those would make the desktop treat the file as a Gaussian splat).
/// Comments must be plain ASCII: the desktop measures the header in characters.
func scanPLYHeader(count: Int, comments: [String] = []) -> Data {
    var header = "ply\nformat binary_little_endian 1.0\ncomment Ghost Arcade LiDAR scan\ncomment units meters; up +Y; front +Z; right-handed\n"
    for comment in comments {
        let clean = String(comment.unicodeScalars.map { $0.isASCII && $0.value >= 32 && $0.value < 127 ? Character($0) : Character("?") })
        header += "comment \(clean.prefix(200))\n"
    }
    header += "element vertex \(count)\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
    return Data(header.utf8)
}
let scanPLYBytesPerPoint = 15

func encodeScanPLYBody(positions: ArraySlice<SIMD3<Float>>, colors: ArraySlice<SIMD3<UInt8>>) -> Data {
    var bytes = [UInt8](repeating: 0, count: positions.count * scanPLYBytesPerPoint)
    bytes.withUnsafeMutableBytes { raw in
        var o = 0
        for (p, c) in zip(positions, colors) {
            raw.storeBytes(of: p.x.bitPattern.littleEndian, toByteOffset: o, as: UInt32.self)
            raw.storeBytes(of: p.y.bitPattern.littleEndian, toByteOffset: o + 4, as: UInt32.self)
            raw.storeBytes(of: p.z.bitPattern.littleEndian, toByteOffset: o + 8, as: UInt32.self)
            raw[o + 12] = c.x; raw[o + 13] = c.y; raw[o + 14] = c.z
            o += scanPLYBytesPerPoint
        }
    }
    return Data(bytes)
}

/// Facts about the scan, written as PLY comments (ignored by loaders, readable by people and tools).
func scanPLYComments(_ r: ScanResult, preset: String, created: String) -> [String] {
    func n(_ v: Float) -> String { String(format: "%.4f", v) }
    let size = r.boundsMax - r.boundsMin
    return [
        "created \(created)", "preset \(preset)", "voxel_size_m \(n(r.voxel))",
        "size_m \(n(size.x)) \(n(size.y)) \(n(size.z))",
        "bounds_min \(n(r.boundsMin.x)) \(n(r.boundsMin.y)) \(n(r.boundsMin.z))",
        "bounds_max \(n(r.boundsMax.x)) \(n(r.boundsMax.y)) \(n(r.boundsMax.z))",
        "from_arkit_world yaw_rad \(n(r.yaw)) then_translate \(n(r.translation.x)) \(n(r.translation.y)) \(n(r.translation.z))",
        "order shuffled", "cleaned weak \(r.droppedWeak) outliers \(r.droppedOutliers) cropped \(r.droppedCrop)",
    ]
}

/// Writes the file in pieces so a large scan never needs a second full copy in memory. Returns the byte size.
@discardableResult
func writeScanPLY(_ result: ScanResult, comments: [String], to file: URL) throws -> Int {
    guard FileManager.default.createFile(atPath: file.path, contents: nil) else { throw NSError(domain: "ScanExport", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not create scan file."]) }
    let out = try FileHandle(forWritingTo: file); defer { try? out.close() }
    let header = scanPLYHeader(count: result.count, comments: comments); try out.write(contentsOf: header)
    for start in stride(from: 0, to: result.count, by: 100_000) {
        let end = min(result.count, start + 100_000)
        try out.write(contentsOf: encodeScanPLYBody(positions: result.positions[start..<end], colors: result.colors[start..<end]))
    }
    try out.synchronize()
    return header.count + result.count * scanPLYBytesPerPoint
}

func scanPreview(of result: ScanResult, maxPoints: Int) -> ScanPreview {
    var out = ScanPreview()
    let step = max(1, Int((Double(result.count) / Double(max(1, maxPoints))).rounded(.up)))
    var xyz: [Float] = [], rgba: [Float] = []
    for i in stride(from: 0, to: result.count, by: step) {
        let p = result.positions[i], c = result.colors[i]
        xyz.append(p.x); xyz.append(p.y); xyz.append(p.z)
        rgba.append(Float(c.x) / 255); rgba.append(Float(c.y) / 255); rgba.append(Float(c.z) / 255); rgba.append(1)
    }
    out.count = xyz.count / 3; out.center = (result.boundsMin + result.boundsMax) / 2
    out.positions = xyz.withUnsafeBufferPointer { Data(buffer: $0) }; out.colors = rgba.withUnsafeBufferPointer { Data(buffer: $0) }
    return out
}

/// A file name that is safe everywhere: letters, digits, space, dash, underscore.
func scanFileName(_ name: String, stamp: String) -> String {
    let allowed = name.unicodeScalars.map { s -> Character in
        (s.isASCII && (CharacterSet.alphanumerics.contains(s) || s == " " || s == "-" || s == "_")) ? Character(s) : " "
    }
    let words = String(allowed).split(separator: " ").joined(separator: " ")
    let base = String((words.isEmpty ? "Scan" : words).prefix(60)).trimmingCharacters(in: .whitespaces)
    return "\(base) \(stamp).ply"
}

// MARK: Guidance

enum ScanHint: Equatable {
    case none, tooClose, tooFar, moveSlower, lowLight, covered, noDepth
    var text: String {
        switch self {
        case .none: return ""
        case .tooClose: return "Too close. Move back a little."
        case .tooFar: return "Too far. Move closer."
        case .moveSlower: return "Move slower."
        case .lowLight: return "Low light. Colors may look noisy."
        case .covered: return "This part is done. Scan a new area."
        case .noDepth: return "No depth here. Aim at a solid surface."
        }
    }
}

/// Picks the one hint that matters most for the latest frame.
/// `speed` in m/s, `turn` in degrees per second, `light` in lumens (about 1000 indoors), `recentNew` = share of new points lately.
func scanHint(stats: ScanFrameStats, speed: Float, turn: Float, light: Float?, recentNew: Float, hasPoints: Bool) -> ScanHint {
    if speed > 0.6 || turn > 70 { return .moveSlower }
    let seen = max(1, stats.considered)
    if Float(stats.tooNear) / Float(seen) > 0.35 { return .tooClose }
    if Float(stats.tooFar) / Float(seen) > 0.6 { return .tooFar }
    if stats.considered == 0 || Float(stats.valid) / Float(seen) < 0.08 { return stats.tooFar > stats.tooNear ? .tooFar : .noDepth }
    if let light = light, light < 120 { return .lowLight }
    if hasPoints, recentNew < 0.01 { return .covered }
    return .none
}
/// Frames taken while the device moves this fast are smeared and misplaced: skip them.
func scanTooFastToMerge(speed: Float, turn: Float) -> Bool { speed > 1.2 || turn > 120 }
