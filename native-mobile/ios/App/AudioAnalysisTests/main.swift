import Foundation

// Mac tests for AudioAnalysisCore: its spectrum must equal the Web Audio
// AnalyserNode's (Blackman window, |X|/N, smoothing 0.7, -100..-30 dB to bytes),
// which the phone's visuals were tuned on.

var failures = 0
func check(_ ok: Bool, _ label: String) {
    print(ok ? "PASS" : "FAIL", label)
    if !ok { failures += 1 }
}

let n = AudioAnalysisCore.fftSize

// Reference: a direct DFT of the windowed block, the first smoothing step from
// zero (0.3 * |X|), dB, bytes. Written independently of the FFT under test.
func referenceSpectrum(_ block: [Float]) -> [UInt8] {
    var out = [UInt8](repeating: 0, count: n / 2)
    for k in 0..<(n / 2) {
        var re = 0.0, im = 0.0
        for i in 0..<n {
            let x = Double(i) / Double(n)
            let w = 0.42 - 0.5 * cos(2 * .pi * x) + 0.08 * cos(4 * .pi * x)
            let v = Double(block[i]) * w
            re += v * cos(-2 * .pi * Double(k * i) / Double(n))
            im += v * sin(-2 * .pi * Double(k * i) / Double(n))
        }
        let magnitude = (1 - 0.7) * sqrt(re * re + im * im) / Double(n)
        let db = magnitude > 0 ? 20 * log10(magnitude) : -Double.infinity
        let scaled = 255 / 70 * (db + 100)
        out[k] = scaled.isFinite ? UInt8(max(0, min(255, floor(scaled)))) : 0
    }
    return out
}

// 1. Random-ish signal: every bin matches the reference within one step.
do {
    var seed: UInt32 = 12345
    let block: [Float] = (0..<n).map { _ in
        seed = seed &* 1664525 &+ 1013904223
        return (Float(seed >> 8) / Float(1 << 24) - 0.5) * 0.02
    }
    let core = AudioAnalysisCore()
    core.push(block, rate: 48_000)
    let got = core.frame().spectrum
    let want = referenceSpectrum(block)
    let worst = zip(got, want).map { abs(Int($0) - Int($1)) }.max() ?? 0
    check(worst <= 1, "spectrum matches the AnalyserNode formula (worst bin off by \(worst))")
}

// 2. A 1 kHz tone at 48 kHz peaks in bin 21 or 22 (1000 / 46.875 = 21.3).
do {
    let core = AudioAnalysisCore()
    let tone = (0..<(n * 2)).map { Float(0.001 * sin(2 * Double.pi * 1000 * Double($0) / 48_000)) }
    core.push(tone, rate: 48_000)
    var spectrum = [UInt8]()
    for _ in 0..<30 { spectrum = core.frame().spectrum }
    let peak = spectrum.indices.max { spectrum[$0] < spectrum[$1] } ?? -1
    check(peak == 21 || peak == 22, "1 kHz tone peaks at bin \(peak)")
    check(spectrum[200] < spectrum[peak] / 2, "far bins stay low (bin 200 = \(spectrum[200]), peak = \(spectrum[peak]))")
}

// 3. Silence: flat waveform at 128, empty spectrum.
do {
    let core = AudioAnalysisCore()
    let frame = core.frame()
    check(frame.waveform.allSatisfy { $0 == 128 }, "silence waveform is 128")
    check(frame.spectrum.allSatisfy { $0 == 0 }, "silence spectrum is 0")
}

// 4. Waveform bytes follow floor(128 * (1 + x)).
do {
    let core = AudioAnalysisCore()
    core.push([Float](repeating: 0.5, count: n), rate: 48_000)
    check(core.frame().waveform.allSatisfy { $0 == 192 }, "waveform of 0.5 is 192")
}

// 5. The broadcast packet round-trips and rejects foreign data.
do {
    let samples: [Int16] = [0, 16384, -16384, 32767, -32768]
    let data = PhoneAudioPacket.encode(sequence: 7, rate: 44_100, samples: samples[...])
    let decoded = PhoneAudioPacket.decode(data)
    check(decoded?.sequence == 7 && decoded?.rate == 44_100, "packet header round-trips")
    check(decoded.map { abs($0.samples[1] - 0.5) < 0.0001 && abs($0.samples[4] + 1) < 0.0001 } == true, "packet samples round-trip")
    check(PhoneAudioPacket.decode(Data(repeating: 1, count: 40)) == nil, "foreign data is rejected")
}

// 6. Downmix: the PCM layouts ReplayKit can hand over all come out as the same mono.
do {
    // Two frames of stereo: (0.5, 0.25) and (-1, 0) -> mono 0.375 and -0.5.
    let left: [Float] = [0.5, -1], right: [Float] = [0.25, 0]
    let want: [Int16] = [12288, -16384]
    func bytes<T>(_ values: [T]) -> [UInt8] { values.withUnsafeBytes { Array($0) } }
    func run(_ buffers: [[UInt8]], bits: Int, float: Bool, big: Bool, split: Bool) -> [Int16]? {
        let copies = buffers.map { b -> UnsafeMutableRawBufferPointer in
            let p = UnsafeMutableRawBufferPointer.allocate(byteCount: b.count, alignment: 1)
            p.copyBytes(from: b); return p
        }
        defer { copies.forEach { $0.deallocate() } }
        return PhoneAudioPacket.downmix(copies.map { UnsafeRawBufferPointer($0) }, frames: 2, channels: 2,
                                        bitsPerChannel: bits, isFloat: float, bigEndian: big, nonInterleaved: split)
    }
    let i16: [Int16] = [16384, 8192, -32768, 0]
    let i32: [Int32] = [1 << 30, 1 << 29, Int32.min, 0]
    let littleInterleaved = run([bytes(i16)], bits: 16, float: false, big: false, split: false)
    let bigInterleaved = run([bytes(i16.map { (v: Int16) -> Int16 in v.bigEndian })], bits: 16, float: false, big: true, split: false)
    let floatSplit = run([bytes(left), bytes(right)], bits: 32, float: true, big: false, split: true)
    let int32 = run([bytes(i32)], bits: 32, float: false, big: false, split: false)
    func near(_ got: [Int16]?) -> Bool { got.map { zip($0, want).allSatisfy { abs(Int($0) - Int($1)) <= 2 } } ?? false }
    check(near(littleInterleaved), "16-bit little-endian stereo downmixes (\(littleInterleaved ?? []))")
    check(near(bigInterleaved), "16-bit big-endian stereo downmixes (\(bigInterleaved ?? []))")
    check(near(floatSplit), "32-bit float non-interleaved stereo downmixes (\(floatSplit ?? []))")
    check(near(int32), "32-bit integer stereo downmixes (\(int32 ?? []))")
    check(run([bytes(i16)], bits: 24, float: false, big: false, split: false) == nil, "24-bit packed is declined")
    check(run([[0, 0]], bits: 16, float: false, big: false, split: false) == nil, "a short buffer is declined")
}

print(failures == 0 ? "ALL PASSED" : "\(failures) FAILED")
exit(failures == 0 ? 0 : 1)
