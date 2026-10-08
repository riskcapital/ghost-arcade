import Foundation
import simd

// Mac-side tests for ScanCore.swift. Synthetic LiDAR frames (256 x 192, like the real sensor) are
// ray-cast from simple scenes, with depth noise, flying pixels and bad readings added.
// Run: native-mobile/scripts/test-scan-core.sh

var failures = 0
func check(_ name: String, _ ok: Bool, _ detail: String = "") {
    print("\(ok ? "PASS" : "FAIL")  \(name)\(detail.isEmpty ? "" : "  [\(detail)]")")
    if !ok { failures += 1 }
}
func f(_ v: Float, _ digits: Int = 4) -> String { String(format: "%.\(digits)f", v) }

struct Random {
    var state: UInt64
    mutating func next() -> Float {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state; z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9; z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB; z ^= z >> 31
        return Float(z >> 40) / Float(1 << 24)
    }
    mutating func gauss() -> Float { let u = max(next(), 1e-7), v = next(); return sqrt(-2 * log(u)) * cos(2 * .pi * v) }
}

enum Shape {
    case plane(point: SIMD3<Float>, normal: SIMD3<Float>)
    case box(lo: SIMD3<Float>, hi: SIMD3<Float>)
    case sphere(center: SIMD3<Float>, radius: Float)
    func hit(_ o: SIMD3<Float>, _ d: SIMD3<Float>) -> Float? {
        switch self {
        case let .plane(point, normal):
            let denom = simd_dot(d, normal); guard abs(denom) > 1e-6 else { return nil }
            let t = simd_dot(point - o, normal) / denom; return t > 1e-4 ? t : nil
        case let .box(lo, hi):
            let inv = SIMD3<Float>(repeating: 1) / d
            let a = (lo - o) * inv, b = (hi - o) * inv
            let near = simd_reduce_max(simd_min(a, b)), far = simd_reduce_min(simd_max(a, b))
            return near <= far && far > 1e-4 ? (near > 1e-4 ? near : nil) : nil
        case let .sphere(center, radius):
            let oc = o - center, a = simd_dot(d, d), b = 2 * simd_dot(oc, d), c = simd_dot(oc, oc) - radius * radius
            let disc = b * b - 4 * a * c; guard disc >= 0 else { return nil }
            let t = (-b - sqrt(disc)) / (2 * a); return t > 1e-4 ? t : nil
        }
    }
    func distance(_ p: SIMD3<Float>) -> Float {
        switch self {
        case let .plane(point, normal): return abs(simd_dot(p - point, simd_normalize(normal)))
        case let .box(lo, hi):
            let q = simd_max(simd_max(lo - p, p - hi), SIMD3<Float>(repeating: 0))
            let outside = simd_length(q)
            if outside > 0 { return outside }
            return simd_reduce_min(simd_min(p - lo, hi - p))
        case let .sphere(center, radius): return abs(simd_length(p - center) - radius)
        }
    }
}
func sceneDistance(_ scene: [Shape], _ p: SIMD3<Float>) -> Float { scene.map { $0.distance(p) }.min() ?? .infinity }
/// Smooth surface colour as a function of world position, so colours can be checked after merging.
func albedo(_ p: SIMD3<Float>) -> SIMD3<Float> { SIMD3(128 + 90 * sin(2.5 * p.x), 128 + 90 * sin(2.5 * p.y + 1), 128 + 90 * sin(2.5 * p.z + 2)) }

func lookAt(_ eye: SIMD3<Float>, _ target: SIMD3<Float>) -> simd_float4x4 {
    let back = simd_normalize(eye - target), right = simd_normalize(simd_cross(SIMD3<Float>(0, 1, 0), back)), up = simd_cross(back, right)
    return simd_float4x4(columns: (SIMD4(right, 0), SIMD4(up, 0), SIMD4(back, 0), SIMD4(eye, 1)))
}

let W = 256, H = 192
let FX: Float = 212, FY: Float = 212, CX: Float = 128, CY: Float = 96

struct Rendered { var depth: [Float]; var confidence: [UInt8]; var rgb: [UInt8]; var transform: simd_float4x4 }
/// `noise` = depth sigma in metres at 1 m. `flying` adds mixed-depth pixels at edges; `salt` adds random bad readings.
func render(_ scene: [Shape], _ transform: simd_float4x4, rng: inout Random, noise: Float = 0, flying: Bool = false, salt: Float = 0, brightness: Float = 1) -> Rendered {
    var out = Rendered(depth: [Float](repeating: .nan, count: W * H), confidence: [UInt8](repeating: 2, count: W * H), rgb: [UInt8](repeating: 0, count: W * H * 3), transform: transform)
    let o = SIMD3<Float>(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
    for y in 0..<H { for x in 0..<W {
        let local = SIMD4<Float>((Float(x) + 0.5 - CX) / FX, -(Float(y) + 0.5 - CY) / FY, -1, 0)
        let world = transform * local, d = SIMD3<Float>(world.x, world.y, world.z)
        var best: Float = .infinity
        for shape in scene { if let t = shape.hit(o, d), t < best { best = t } }
        guard best.isFinite else { continue }
        let c = simd_clamp(albedo(o + d * best) * brightness, SIMD3<Float>(repeating: 0), SIMD3<Float>(repeating: 255))
        out.depth[y * W + x] = best
        out.rgb[(y * W + x) * 3] = UInt8(c.x); out.rgb[(y * W + x) * 3 + 1] = UInt8(c.y); out.rgb[(y * W + x) * 3 + 2] = UInt8(c.z)
    } }
    let clean = out.depth
    for y in 1..<(H - 1) { for x in 1..<(W - 1) {
        let i = y * W + x, z = clean[i]; guard z.isFinite else { continue }
        if flying {
            for n in [clean[i - 1], clean[i + 1], clean[i - W], clean[i + W]] where n.isFinite && abs(n - z) > 0.08 && rng.next() < 0.5 {
                out.depth[i] = z + (n - z) * rng.next(); out.confidence[i] = rng.next() < 0.5 ? 0 : (rng.next() < 0.5 ? 1 : 2); break
            }
        }
        if salt > 0, rng.next() < salt { out.depth[i] = 0.3 + rng.next() * 4; out.confidence[i] = 2 }
        else if noise > 0, out.depth[i] == z { out.depth[i] = z + rng.gauss() * noise * z; if rng.next() < 0.1 { out.confidence[i] = 1 } }
    } }
    return out
}
func integrate(_ acc: ScanAccumulator, _ r: Rendered, step: Int = 1, singleFrame: Bool = false) -> ScanFrameStats {
    r.depth.withUnsafeBufferPointer { d in r.confidence.withUnsafeBufferPointer { c in r.rgb.withUnsafeBufferPointer { rgb in
        acc.integrate(ScanFrame(width: W, height: H, depth: d.baseAddress!, depthRow: W, confidence: c.baseAddress!, confidenceRow: W, rgb: rgb.baseAddress!, fx: FX, fy: FY, cx: CX, cy: CY, transform: r.transform), step: step, singleFrame: singleFrame)
    } } }
}
/// Undo the export transform: file coordinates back to the synthetic world.
func toWorld(_ p: SIMD3<Float>, _ r: ScanResult) -> SIMD3<Float> {
    let q = p - r.translation, c = cos(-r.yaw), s = sin(-r.yaw)
    return SIMD3(q.x * c + q.z * s, q.y, -q.x * s + q.z * c)
}
/// What the old scanner did: every pixel with confidence >= 1 into a voxel, no other checks.
func naiveCloud(_ frames: [Rendered], voxel: Float, maxDepth: Float) -> [SIMD3<Float>] {
    var cells: [UInt64: (SIMD3<Float>, Float)] = [:]
    for r in frames { for y in 0..<H { for x in 0..<W {
        let z = r.depth[y * W + x]; guard r.confidence[y * W + x] >= 1, z.isFinite, z > 0.2, z < maxDepth else { continue }
        let p = scanWorldPoint(x: Float(x) + 0.5, y: Float(y) + 0.5, depth: z, fx: FX, fy: FY, cx: CX, cy: CY, transform: r.transform)
        guard let key = scanCellKey(p, size: voxel) else { continue }
        if let old = cells[key] { let w = min(old.1, 15); cells[key] = ((old.0 * w + p) / (w + 1), w + 1) } else { cells[key] = (p, 1) }
    } } }
    return cells.values.map { $0.0 }
}
func extent(_ points: [SIMD3<Float>]) -> SIMD3<Float> {
    guard var lo = points.first else { return .zero }; var hi = lo
    for p in points { lo = simd_min(lo, p); hi = simd_max(hi, p) }
    return hi - lo
}

// MARK: Scenes

let outDir = CommandLine.arguments.count > 1 ? URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true) : FileManager.default.temporaryDirectory.appendingPathComponent("scan-core-tests", isDirectory: true)
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
var expectations: [[String: Any]] = []

/// The synthetic world is the scene turned 25 degrees about the vertical, like a real ARKit session
/// that started at an arbitrary heading.
let worldTurn: Float = 25 * .pi / 180
let Rw = simd_float4x4(simd_quatf(angle: worldTurn, axis: SIMD3<Float>(0, 1, 0)))
func sceneToWorld(_ t: simd_float4x4) -> simd_float4x4 { Rw * t }
func worldToScene(_ p: SIMD3<Float>) -> SIMD3<Float> { let q = Rw.inverse * SIMD4(p, 1); return SIMD3(q.x, q.y, q.z) }

let room: [Shape] = [
    .box(lo: SIMD3(-1.5, -0.05, -1.2), hi: SIMD3(1.5, 0, 1.2)),      // floor
    .box(lo: SIMD3(-1.5, 0, -1.25), hi: SIMD3(1.5, 1.6, -1.2)),      // back wall
    .box(lo: SIMD3(-0.3, 0, -0.6), hi: SIMD3(0.3, 0.5, -0.1)),       // crate
]
func roomPoses(offset: Float = 0) -> [simd_float4x4] {
    var poses: [simd_float4x4] = []
    for (height, target) in [(Float(1.2), SIMD3<Float>(0, 0.3, -0.5)), (0.7, SIMD3(0, 0.3, -0.6)), (1.3, SIMD3(0, 1.0, -1.2))] {
        for k in 0..<30 { let x = -1.2 + 2.4 * (Float(k) + offset) / 29; poses.append(sceneToWorld(lookAt(SIMD3(x, height, 1.3), target + SIMD3(x * 0.6, 0, 0)))) }
    }
    return poses
}
func renderRoom(seed: UInt64, offset: Float = 0, brightness: Float = 1, dirty: Bool = true) -> [Rendered] {
    var rng = Random(state: seed)
    return roomPoses(offset: offset).map { pose in
        var scenePose = Rw.inverse * pose; scenePose.columns.3.w = 1
        var r = render(room, scenePose, rng: &rng, noise: dirty ? 0.002 : 0, flying: dirty, salt: dirty ? 0.002 : 0, brightness: brightness)
        r.transform = pose; return r
    }
}
func farFromScene(_ points: [SIMD3<Float>], _ scene: [Shape], limit: Float = 0.015) -> Int { points.filter { sceneDistance(scene, worldToScene($0)) > limit }.count }
func angleDegrees(_ a: Float) -> Float { var d = a * 180 / .pi; while d > 180 { d -= 360 }; while d < -180 { d += 360 }; return d }

// 1. Room with noise, flying pixels and bad readings.
let roomFrames = renderRoom(seed: 1)
let acc = ScanAccumulator(preset: .balanced); acc.maxDepth = 3.5
var started = Date()
for r in roomFrames { _ = integrate(acc, r) }
let integrateMs = Date().timeIntervalSince(started) * 1000 / Double(roomFrames.count)
started = Date()
let result = acc.finalize()
let finalizeMs = Date().timeIntervalSince(started) * 1000
let back = result.positions.map { toWorld($0, result) }
let distances = back.map { sceneDistance(room, worldToScene($0)) }
let rms = sqrt(distances.reduce(0) { $0 + $1 * $1 } / Float(distances.count))
let far = distances.filter { $0 > 0.015 }.count
let naive = naiveCloud(roomFrames, voxel: 0.008, maxDepth: 3.5)
let naiveFar = farFromScene(naive, room)
print("room: frames \(roomFrames.count), captured \(result.captured), exported \(result.count), weak \(result.droppedWeak), outliers \(result.droppedOutliers)")
print("room: integrate \(f(Float(integrateMs), 2)) ms/frame, finalize \(f(Float(finalizeMs), 1)) ms (Mac)")
check("room: points lie on the surfaces", rms < 0.003, "rms \(f(rms * 1000, 2)) mm")
check("room: stray points removed (under 0.05%)", far <= result.count / 2000, "new \(far) of \(result.count) beyond 15 mm; old scanner \(naiveFar) of \(naive.count)")
let size = result.boundsMax - result.boundsMin, naiveSize = extent(naive)
check("room: bounding box is the scanned part of the room (3.0 x 1.6 x about 1.7 m)", abs(size.x - 3.0) < 0.04 && abs(size.y - 1.6) < 0.04 && size.z > 1.5 && size.z < 1.9, "new \(f(size.x, 2)) x \(f(size.y, 2)) x \(f(size.z, 2)); old scanner \(f(naiveSize.x, 2)) x \(f(naiveSize.y, 2)) x \(f(naiveSize.z, 2))")
check("room: kept nearly all real surface", Float(result.count) > 0.93 * Float(result.captured - result.droppedWeak), "\(result.count) of \(result.captured - result.droppedWeak) solid points")
// Orientation: the scan was made looking at the back wall, 25 degrees off the world axes.
let residual = angleDegrees(result.yaw + worldTurn)
check("room: back wall away from the viewer", abs(residual) < 1.0, "residual turn \(f(residual, 2)) deg")
check("room: floor at y = 0, centred in x and z", abs(result.translation.y) < 0.006 && result.boundsMin.y == 0 && abs(result.boundsMin.x + result.boundsMax.x) < 1e-4 && abs(result.boundsMin.z + result.boundsMax.z) < 1e-4, "floor offset \(f(result.translation.y * 1000, 2)) mm")
// A sweep that looks 20 degrees to one side: the view alone would leave the walls skewed.
var skewRandom = Random(state: 7)
let skew = ScanAccumulator(preset: .balanced); skew.maxDepth = 3.5
for k in 0..<40 { let x = -1.2 + 2.4 * Float(k) / 39, scenePose = lookAt(SIMD3(x, 1.1, 1.3), SIMD3(x + 0.9, 0.5, -1.2))
    var r = render(room, scenePose, rng: &skewRandom, noise: 0.002, flying: true, salt: 0.002); r.transform = sceneToWorld(scenePose); _ = integrate(skew, r) }
var noAlign = ScanFinalizeOptions(); noAlign.alignWalls = false
let skewed = skew.finalize(), viewOnly = skew.finalize(noAlign)
check("room: walls squared to the axes after a sideways sweep", skewed.wallAligned && abs(angleDegrees(skewed.yaw + worldTurn)) < 1.0, "residual turn \(f(angleDegrees(skewed.yaw + worldTurn), 2)) deg; view only \(f(angleDegrees(viewOnly.yaw + worldTurn), 2)) deg")
// Density: 10 cm tiles on the back wall above the crate.
func tileStats(_ points: [SIMD3<Float>]) -> (mean: Float, cv: Float, empty: Int) {
    var tiles = [Int](repeating: 0, count: 24 * 6)
    for p in points { let s = worldToScene(p); guard s.z < -1.19, s.z > -1.21, s.x > -1.2, s.x < 1.2, s.y > 0.6, s.y < 1.2 else { continue }
        tiles[min(23, Int((s.x + 1.2) * 10)) + 24 * min(5, Int((s.y - 0.6) * 10))] += 1 }
    let mean = Float(tiles.reduce(0, +)) / Float(tiles.count)
    let sd = sqrt(tiles.reduce(Float(0)) { $0 + (Float($1) - mean) * (Float($1) - mean) } / Float(tiles.count))
    return (mean, sd / max(mean, 1), tiles.filter { $0 == 0 }.count)
}
let tiles = tileStats(back)
check("room: even density on the wall", tiles.cv < 0.12 && tiles.empty == 0, "mean \(f(tiles.mean, 1)) points per 10 cm tile, variation \(f(tiles.cv * 100, 1))%")
// Colour against the known surface colour.
func colourError(_ r: ScanResult) -> Float {
    var total: Float = 0
    for i in 0..<r.count { let want = albedo(worldToScene(toWorld(r.positions[i], r))), got = SIMD3<Float>(Float(r.colors[i].x), Float(r.colors[i].y), Float(r.colors[i].z)); total += simd_reduce_add(simd_abs(want - got)) / 3 }
    return total / Float(max(1, r.count))
}
let colour = colourError(result)
check("room: colours match the surface", colour < 4, "mean error \(f(colour, 2)) of 255")
// Order: every 10th point (what the desktop keeps when thinning) must still cover the wall evenly.
let thinned = stride(from: 0, to: back.count, by: 10).map { back[$0] }, thin = tileStats(thinned)
check("room: file order is unbiased (every 10th point)", thin.empty == 0 && abs(thin.mean * 10 / tiles.mean - 1) < 0.05 && thin.cv < 0.35, "mean \(f(thin.mean, 1)) per tile, variation \(f(thin.cv * 100, 1))%")

func export(_ r: ScanResult, _ name: String, preset: String) {
    let file = outDir.appendingPathComponent(name)
    do {
        let bytes = try writeScanPLY(r, comments: scanPLYComments(r, preset: preset, created: "2026-10-08T12:00:00Z") + ["name caf\u{e9} \u{1F47B}"], to: file)
        let data = try Data(contentsOf: file)
        let headerEnd = data.range(of: Data("end_header\n".utf8))!.upperBound
        check("\(name): size is header + 15 bytes per point", bytes == data.count && data.count == headerEnd + r.count * 15, "\(data.count) bytes, \(r.count) points")
        check("\(name): header is plain ASCII", data[..<headerEnd].allSatisfy { $0 < 128 })
        var mean = SIMD3<Double>(repeating: 0); for c in r.colors { mean += SIMD3(Double(c.x), Double(c.y), Double(c.z)) }
        mean /= Double(max(1, r.count))
        expectations.append(["file": name, "count": r.count, "min": [r.boundsMin.x, r.boundsMin.y, r.boundsMin.z], "max": [r.boundsMax.x, r.boundsMax.y, r.boundsMax.z],
                             "meanColor": [mean.x, mean.y, mean.z], "first": [r.positions[0].x, r.positions[0].y, r.positions[0].z], "firstColor": [Int(r.colors[0].x), Int(r.colors[0].y), Int(r.colors[0].z)]])
    } catch { check("\(name): written", false, "\(error)") }
}
export(result, "room-balanced.ply", preset: "balanced")

// 2. Point limit: density must stay even and nothing may be starved once the limit is reached.
let tiny = ScanAccumulator(preset: ScanPreset(name: "tiny", voxel: 0.005, maxPoints: 120_000)); tiny.maxDepth = 3.5
var peak = 0, coarsenings = 0
for r in roomFrames { let s = integrate(tiny, r); peak = max(peak, tiny.count); if s.coarsened { coarsenings += 1 } }
let tinyResult = tiny.finalize(), tinyTiles = tileStats(tinyResult.positions.map { toWorld($0, tinyResult) })
check("limit: count never exceeds the limit", peak <= 120_000, "peak \(peak), voxel grew 5.0 -> \(f(tiny.voxel * 1000, 1)) mm in \(coarsenings) steps")
check("limit: whole wall still covered evenly", tinyTiles.empty == 0 && tinyTiles.cv < 0.15, "mean \(f(tinyTiles.mean, 1)) per tile, variation \(f(tinyTiles.cv * 100, 1))%")
for preset in ScanPreset.all {
    let a = ScanAccumulator(preset: preset); a.maxDepth = 3.5
    for r in roomFrames { _ = integrate(a, r) }
    print("preset \(preset.name): \(a.finalize().count) points for this 3 m room at \(f(a.voxel * 1000, 1)) mm (limit \(preset.maxPoints))")
}

// 3. Exposure: a second pass 30% darker must not stripe the colours.
let dark = renderRoom(seed: 2, offset: 0.5, brightness: 0.7)
let matched = ScanAccumulator(preset: .balanced); matched.maxDepth = 3.5
var gains: [Float] = []
for r in roomFrames { _ = integrate(matched, r) }
for r in dark { gains.append(integrate(matched, r).gain) }
let matchedError = colourError(matched.finalize()), meanGain = gains.reduce(0, +) / Float(gains.count)
check("exposure: darker pass is matched to the first", matchedError < 6 && abs(meanGain - 1 / 0.7) < 0.08, "colour error \(f(matchedError, 2)) of 255, mean gain \(f(meanGain, 3)) (ideal 1.429)")

// 4. Undo: the second sweep's new points go, the first sweep stays.
let undo = ScanAccumulator(preset: .balanced); undo.maxDepth = 3.5
for r in roomFrames.prefix(10) { _ = integrate(undo, r) }
let afterFirst = undo.count
undo.beginSweep()
for r in roomFrames.suffix(20) { _ = integrate(undo, r) }
let afterSecond = undo.count, removed = undo.undoLastSweep()
check("undo: last sweep removed, first kept", afterSecond > afterFirst && undo.count == afterFirst && removed == afterSecond - afterFirst && undo.sweep == 0, "\(afterFirst) -> \(afterSecond) -> \(undo.count)")
for r in roomFrames.suffix(5) { _ = integrate(undo, r) }
check("undo: scanning continues after undo", undo.count > afterFirst && undo.finalize().count > 0)

// 5. Object on a floor with clutter behind it, circled once.
let stage: [Shape] = [
    .box(lo: SIMD3(-2, -0.05, -2), hi: SIMD3(2, 0, 2)), .sphere(center: SIMD3(0, 0.25, 0), radius: 0.25),
    .box(lo: SIMD3(1.9, 0, -2), hi: SIMD3(1.95, 1.5, 2)), .box(lo: SIMD3(-1.6, 0, 1.2), hi: SIMD3(-1.2, 0.6, 1.6)),
]
var rng = Random(state: 5)
let orbit: [Rendered] = (0..<72).map { k in
    let a = Float(k) / 72 * 2 * .pi, scenePose = lookAt(SIMD3(0.9 * cos(a), 0.7, 0.9 * sin(a)), SIMD3(0, 0.2, 0))
    var r = render(stage, scenePose, rng: &rng, noise: 0.002, flying: true, salt: 0.002); r.transform = sceneToWorld(scenePose); return r
}
let object = ScanAccumulator(preset: .detail); object.maxDepth = 3
for r in orbit { _ = integrate(object, r) }
var options = ScanFinalizeOptions(); let whole = object.finalize(options)
options.autoCrop = true; let cropped = object.finalize(options)
func onSphere(_ r: ScanResult) -> Int { r.positions.filter { abs(simd_length(worldToScene(toWorld($0, r)) - SIMD3(0, 0.25, 0)) - 0.25) < 0.006 }.count }
let croppedSize = cropped.boundsMax - cropped.boundsMin, wholeSize = whole.boundsMax - whole.boundsMin
let clutter = cropped.positions.filter { let s = worldToScene(toWorld($0, cropped)); return s.x > 1.5 || (s.x < -1.1 && s.z > 1.1) }.count
check("crop: clutter gone, subject whole", cropped.cropped && clutter == 0 && onSphere(cropped) == onSphere(whole) && onSphere(cropped) > 5000 && croppedSize.x < 0.9 && croppedSize.z < 0.9 && croppedSize.x > 0.6,
      "footprint \(f(wholeSize.x, 2)) x \(f(wholeSize.z, 2)) m -> \(f(croppedSize.x, 2)) x \(f(croppedSize.z, 2)) m, \(onSphere(cropped)) points on the sphere, \(whole.count) -> \(cropped.count)")
// A full circle has no average direction: the first view decides the front (it looked along -x in the scene).
let front = angleDegrees(cropped.yaw + worldTurn + .pi / 2)
check("crop: first view faces the desktop camera", abs(front) < 2, "off by \(f(front, 2)) deg")
let sphereFar = cropped.positions.filter { sceneDistance(stage, worldToScene(toWorld($0, cropped))) > 0.015 }.count
check("crop: no stray points", sphereFar <= cropped.count / 5000, "\(sphereFar) of \(cropped.count) beyond 15 mm")
export(cropped, "object-detail-cropped.ply", preset: "detail")
// A straight-on scan has nothing to circle: crop must leave it alone.
var roomCrop = ScanFinalizeOptions(); roomCrop.autoCrop = true
check("crop: not applied to a sweep along a wall", !acc.finalize(roomCrop).cropped)

// 6. Depth playground: one frame at a time.
let live = ScanAccumulator(preset: .balanced); live.maxDepth = 3.5
_ = integrate(live, roomFrames[40], singleFrame: true); let liveFirst = live.count
_ = integrate(live, roomFrames[41], singleFrame: true)
let liveResult = live.finalize()
check("live: each frame replaces the last and can be saved", liveFirst > 10_000 && abs(live.count - liveFirst) < liveFirst / 5 && liveResult.count > live.count * 8 / 10, "\(liveFirst) then \(live.count) points, saved \(liveResult.count)")
let preview = live.preview(maxPoints: 5000, look: .coverage)
check("preview: thinned to the budget", preview.count > 2500 && preview.count <= 5000 && preview.positions.count == preview.count * 12 && preview.colors.count == preview.count * 16, "\(preview.count) points")

// 7. Small pieces.
var table = ScanCellTable(), reference: [UInt64: Int32] = [:], tableRandom = Random(state: 9), tableOK = true
for i in 0..<200_000 { let key = scanPackCell(Int(tableRandom.next() * 400) - 200, Int(tableRandom.next() * 400) - 200, Int(tableRandom.next() * 40) - 20); table.set(key, Int32(i)); reference[key] = Int32(i) }
for (key, value) in reference where table.find(key) != value { tableOK = false }
check("table: matches Dictionary", tableOK && table.count == reference.count && table.find(scanPackCell(999, 999, 999)) == -1, "\(table.count) cells")
check("table: cell keys round-trip", scanUnpackCell(scanPackCell(-7, 0, 123_456)) == (-7, 0, 123_456) && scanCellKey(SIMD3(.nan, 0, 0), size: 0.01) == nil && scanCellKey(SIMD3(1e9, 0, 0), size: 0.01) == nil)
check("colour: video-range white, black and 709 red", scanRGB(y: 235, cb: 128, cr: 128, videoRange: true, bt709: true) == SIMD3(255, 255, 255) && scanRGB(y: 16, cb: 128, cr: 128, videoRange: true, bt709: false) == SIMD3(0, 0, 0)
      && scanRGB(y: 63, cb: 102, cr: 240, videoRange: true, bt709: true).x == 255 && scanRGB(y: 63, cb: 102, cr: 240, videoRange: true, bt709: true).y <= 2 && scanRGB(y: 63, cb: 102, cr: 240, videoRange: true, bt709: true).z == 0 && scanRGB(y: 128, cb: 128, cr: 128, videoRange: false, bt709: false) == SIMD3(128, 128, 128),
      "709 red -> \(scanRGB(y: 63, cb: 102, cr: 240, videoRange: true, bt709: true))")
check("name: safe file name", scanFileName("  Stage / left: caf\u{e9}  ", stamp: "2026-10-08 1432") == "Stage left caf 2026-10-08 1432.ply" && scanFileName("///", stamp: "x") == "Scan x.ply", scanFileName("  Stage / left: caf\u{e9}  ", stamp: "2026-10-08 1432"))
var s = ScanFrameStats(); s.considered = 1000; s.valid = 900; s.added = 300
check("hints: normal frame is quiet", scanHint(stats: s, speed: 0.1, turn: 10, light: 900, recentNew: 0.3, hasPoints: true) == .none)
check("hints: speed, light, covered", scanHint(stats: s, speed: 0.8, turn: 10, light: 900, recentNew: 0.3, hasPoints: true) == .moveSlower && scanHint(stats: s, speed: 0.1, turn: 90, light: 900, recentNew: 0.3, hasPoints: true) == .moveSlower
      && scanHint(stats: s, speed: 0.1, turn: 10, light: 60, recentNew: 0.3, hasPoints: true) == .lowLight && scanHint(stats: s, speed: 0.1, turn: 10, light: 900, recentNew: 0.001, hasPoints: true) == .covered)
var near = ScanFrameStats(); near.considered = 1000; near.tooNear = 500; near.valid = 400
var away = ScanFrameStats(); away.considered = 1000; away.tooFar = 800; away.valid = 150
check("hints: too close, too far, no depth", scanHint(stats: near, speed: 0, turn: 0, light: nil, recentNew: 1, hasPoints: false) == .tooClose && scanHint(stats: away, speed: 0, turn: 0, light: nil, recentNew: 1, hasPoints: false) == .tooFar
      && scanHint(stats: ScanFrameStats(), speed: 0, turn: 0, light: nil, recentNew: 1, hasPoints: false) == .noDepth)
check("hints: very fast frames are skipped", scanTooFastToMerge(speed: 1.5, turn: 0) && scanTooFastToMerge(speed: 0, turn: 150) && !scanTooFastToMerge(speed: 0.5, turn: 60))
// The frame filter itself: flying pixels and salt readings must not get in.
var probe = Random(state: 3)
let dirtyFrame = render(room, Rw.inverse * roomPoses()[15], rng: &probe, noise: 0.002, flying: true, salt: 0.01)
let single = ScanAccumulator(preset: .detail); single.maxDepth = 3.5
var dirtyTransformed = dirtyFrame; dirtyTransformed.transform = roomPoses()[15]
let dirtyStats = integrate(single, dirtyTransformed)
let singleFar = single.finalize(ScanFinalizeOptions(minFrames: 1, removeOutliers: false, autoCrop: false, alignWalls: false, faceViewer: false, recentre: false)).positions.filter { sceneDistance(room, worldToScene($0)) > 0.015 }.count
check("filter: one dirty frame, before any cleanup (under 0.2% stray)", singleFar <= single.count / 500, "\(singleFar) stray of \(single.count) kept; rejected \(dirtyStats.edges) edge and \(dirtyStats.lowConfidence) low-confidence pixels of \(dirtyStats.considered)")

if let json = try? JSONSerialization.data(withJSONObject: expectations, options: [.prettyPrinted]) { try? json.write(to: outDir.appendingPathComponent("expected.json")) }
print(failures == 0 ? "ALL PASSED" : "\(failures) FAILED")
exit(failures == 0 ? 0 : 1)
