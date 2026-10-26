import Foundation

/// Audio analysis that matches the Web Audio AnalyserNode the visuals were tuned
/// on (fftSize 1024, Blackman window, smoothingTimeConstant 0.7, -100..-30 dB),
/// so a native source drives the shaders exactly like the old web microphone did.
///
/// Samples arrive from any source (microphone tap, the in-app player's mix, or
/// the screen-broadcast extension) into one ring; `frame()` analyses the newest
/// 1024 and returns the byte spectrum and byte waveform the web layer expects.
/// Plain Swift with no iOS frameworks, so it is tested on the Mac.
final class AudioAnalysisCore {
    static let fftSize = 1024
    static let binCount = fftSize / 2
    static let minDecibels: Float = -100
    static let maxDecibels: Float = -30
    static let smoothing: Float = 0.7

    private let lock = NSLock()
    private var ring = [Float](repeating: 0, count: AudioAnalysisCore.fftSize * 4)
    private var writeIndex = 0
    private(set) var samplesWritten: UInt64 = 0
    private(set) var sampleRate: Float = 48_000
    private var smoothed = [Float](repeating: 0, count: AudioAnalysisCore.binCount)
    private let window: [Float]
    private let cosTable: [Float]
    private let sinTable: [Float]
    private let bitReverse: [Int]

    init() {
        let n = AudioAnalysisCore.fftSize
        window = (0..<n).map { i in
            let x = Float(i) / Float(n)
            return 0.42 - 0.5 * cos(2 * Float.pi * x) + 0.08 * cos(4 * Float.pi * x)
        }
        cosTable = (0..<n / 2).map { cos(-2 * Float.pi * Float($0) / Float(n)) }
        sinTable = (0..<n / 2).map { sin(-2 * Float.pi * Float($0) / Float(n)) }
        let bits = Int(log2(Double(n)))
        bitReverse = (0..<n).map { index in
            var reversed = 0
            var value = index
            for _ in 0..<bits { reversed = (reversed << 1) | (value & 1); value >>= 1 }
            return reversed
        }
    }

    /// Append mono samples (-1...1) captured at `rate` Hz.
    func push(_ samples: UnsafeBufferPointer<Float>, rate: Float) {
        lock.lock(); defer { lock.unlock() }
        if rate > 0 { sampleRate = rate }
        for sample in samples {
            ring[writeIndex] = sample.isFinite ? max(-1, min(1, sample)) : 0
            writeIndex = (writeIndex + 1) % ring.count
        }
        samplesWritten &+= UInt64(samples.count)
    }

    func push(_ samples: [Float], rate: Float) {
        samples.withUnsafeBufferPointer { push($0, rate: rate) }
    }

    /// Forget everything, so a new source does not inherit the last one's smoothing.
    func reset() {
        lock.lock(); defer { lock.unlock() }
        for i in ring.indices { ring[i] = 0 }
        for i in smoothed.indices { smoothed[i] = 0 }
        writeIndex = 0
        samplesWritten = 0
    }

    /// One analysis of the newest fftSize samples: the byte spectrum (binCount
    /// values, like getByteFrequencyData) and the byte waveform (fftSize values,
    /// like getByteTimeDomainData). Each call advances the smoothing by one step,
    /// as each AnalyserNode read does.
    func frame() -> (spectrum: [UInt8], waveform: [UInt8]) {
        let n = AudioAnalysisCore.fftSize
        var time = [Float](repeating: 0, count: n)
        lock.lock()
        var read = (writeIndex - n + ring.count) % ring.count
        for i in 0..<n { time[i] = ring[read]; read = (read + 1) % ring.count }
        lock.unlock()

        var waveform = [UInt8](repeating: 128, count: n)
        for i in 0..<n {
            waveform[i] = UInt8(max(0, min(255, floor(128 * (1 + time[i])))))
        }

        var re = [Float](repeating: 0, count: n)
        var im = [Float](repeating: 0, count: n)
        for i in 0..<n { re[bitReverse[i]] = time[i] * window[i] }
        var size = 2
        while size <= n {
            let half = size / 2
            let step = n / size
            var start = 0
            while start < n {
                for k in 0..<half {
                    let wr = cosTable[k * step], wi = sinTable[k * step]
                    let a = start + k, b = a + half
                    let tr = re[b] * wr - im[b] * wi
                    let ti = re[b] * wi + im[b] * wr
                    re[b] = re[a] - tr; im[b] = im[a] - ti
                    re[a] += tr; im[a] += ti
                }
                start += size
            }
            size <<= 1
        }

        var spectrum = [UInt8](repeating: 0, count: AudioAnalysisCore.binCount)
        let range = AudioAnalysisCore.maxDecibels - AudioAnalysisCore.minDecibels
        let k = AudioAnalysisCore.smoothing
        lock.lock()
        for bin in 0..<AudioAnalysisCore.binCount {
            let magnitude = sqrt(re[bin] * re[bin] + im[bin] * im[bin]) / Float(n)
            let value = k * smoothed[bin] + (1 - k) * magnitude
            smoothed[bin] = value.isFinite ? value : 0
            let db = smoothed[bin] > 0 ? 20 * log10(smoothed[bin]) : -Float.infinity
            let scaled = (255 / range) * (db - AudioAnalysisCore.minDecibels)
            spectrum[bin] = scaled.isFinite ? UInt8(max(0, min(255, floor(scaled)))) : 0
        }
        lock.unlock()
        return (spectrum, waveform)
    }
}

/// The loopback packet the screen-broadcast extension sends the app: mono
/// 16-bit samples at the broadcast's rate. Shared by both targets.
enum PhoneAudioPacket {
    static let port: UInt16 = 47_213
    static let magic: UInt32 = 0x4741_5041 // "GAPA"
    static let maxSamples = 600

    static func encode(sequence: UInt32, rate: Float, samples: ArraySlice<Int16>) -> Data {
        var data = Data(capacity: 16 + samples.count * 2)
        for value in [magic, sequence, rate.bitPattern, UInt32(samples.count)] {
            var v = value.littleEndian
            withUnsafeBytes(of: &v) { data.append(contentsOf: $0) }
        }
        for sample in samples {
            var v = sample.littleEndian
            withUnsafeBytes(of: &v) { data.append(contentsOf: $0) }
        }
        return data
    }

    /// Mix linear PCM down to mono 16-bit. `buffers` holds one buffer when the
    /// channels are interleaved and one per channel when they are not. Handles
    /// 16- and 32-bit integers and 32-bit floats in either byte order (ReplayKit
    /// hands app audio over as big-endian 16-bit on some devices).
    static func downmix(_ buffers: [UnsafeRawBufferPointer], frames: Int, channels: Int, bitsPerChannel: Int,
                        isFloat: Bool, bigEndian: Bool, nonInterleaved: Bool) -> [Int16]? {
        let bytes = bitsPerChannel / 8
        guard frames > 0, channels > 0, bytes == 2 || bytes == 4, !isFloat || bytes == 4 else { return nil }
        let streams = nonInterleaved ? channels : 1
        let stride = nonInterleaved ? 1 : channels
        guard buffers.count >= streams else { return nil }
        for b in 0..<streams where buffers[b].count < frames * stride * bytes { return nil }
        func sample(_ buffer: UnsafeRawBufferPointer, _ index: Int) -> Float {
            let offset = index * bytes
            if bytes == 2 {
                let raw = buffer.loadUnaligned(fromByteOffset: offset, as: UInt16.self)
                return Float(Int16(bitPattern: bigEndian ? UInt16(bigEndian: raw) : UInt16(littleEndian: raw))) / 32768
            }
            let raw = buffer.loadUnaligned(fromByteOffset: offset, as: UInt32.self)
            let word = bigEndian ? UInt32(bigEndian: raw) : UInt32(littleEndian: raw)
            return isFloat ? Float(bitPattern: word) : Float(Double(Int32(bitPattern: word)) / 2_147_483_648)
        }
        var out = [Int16](repeating: 0, count: frames)
        for i in 0..<frames {
            var sum: Float = 0
            for c in 0..<channels {
                sum += nonInterleaved ? sample(buffers[c], i) : sample(buffers[0], i * channels + c)
            }
            let value = sum / Float(channels)
            out[i] = Int16(max(-32768, min(32767, (value.isFinite ? value : 0) * 32768)))
        }
        return out
    }

    static func decode(_ data: Data) -> (sequence: UInt32, rate: Float, samples: [Float])? {
        guard data.count >= 16 else { return nil }
        func word(_ offset: Int) -> UInt32 {
            data.withUnsafeBytes { UInt32(littleEndian: $0.loadUnaligned(fromByteOffset: offset, as: UInt32.self)) }
        }
        guard word(0) == magic else { return nil }
        let count = Int(word(12))
        guard count <= maxSamples * 4, data.count >= 16 + count * 2 else { return nil }
        let rate = Float(bitPattern: word(8))
        var samples = [Float](repeating: 0, count: count)
        data.withUnsafeBytes { raw in
            for i in 0..<count {
                let value = Int16(littleEndian: raw.loadUnaligned(fromByteOffset: 16 + i * 2, as: Int16.self))
                samples[i] = Float(value) / 32768
            }
        }
        return (word(4), rate, samples)
    }
}
