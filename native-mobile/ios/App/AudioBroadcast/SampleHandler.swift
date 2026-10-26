import CoreMedia
import Network
import ReplayKit

/// Runs while the user broadcasts their screen to Ghost Arcade: sends the sound
/// other apps play (Spotify, YouTube, a DJ app) to the app over loopback, so the
/// visuals can react to it. Video frames are ignored and nothing leaves the phone.
final class SampleHandler: RPBroadcastSampleHandler {
    private let queue = DispatchQueue(label: "ghost.audio.broadcast")
    private var connection: NWConnection?
    private var lastConnect: TimeInterval = 0
    private var sequence: UInt32 = 0

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        queue.async { self.connect() }
    }

    override func broadcastFinished() {
        queue.async { self.connection?.cancel(); self.connection = nil }
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        guard sampleBufferType == .audioApp, let (rate, mono) = Self.mono(sampleBuffer) else { return }
        queue.async {
            // The app's listener goes away while it is in the background; reconnect
            // at most once a second until it is back.
            if self.connection == nil, Date().timeIntervalSince1970 - self.lastConnect > 1 { self.connect() }
            guard let connection = self.connection else { return }
            var start = 0
            while start < mono.count {
                let end = min(mono.count, start + PhoneAudioPacket.maxSamples)
                self.sequence &+= 1
                connection.send(content: PhoneAudioPacket.encode(sequence: self.sequence, rate: rate, samples: mono[start..<end]),
                                completion: .idempotent)
                start = end
            }
        }
    }

    private func connect() {
        lastConnect = Date().timeIntervalSince1970
        guard let port = NWEndpoint.Port(rawValue: PhoneAudioPacket.port) else { return }
        let parameters = NWParameters.udp
        parameters.requiredInterfaceType = .loopback
        let connection = NWConnection(host: "127.0.0.1", port: port, using: parameters)
        connection.stateUpdateHandler = { [weak self, weak connection] state in
            switch state {
            case .failed, .cancelled:
                guard let self = self else { return }
                if self.connection === connection { self.connection = nil }
            default: break
            }
        }
        connection.start(queue: queue)
        self.connection = connection
    }

    /// The buffer's sample rate and its sound mixed down to mono 16-bit.
    private static func mono(_ buffer: CMSampleBuffer) -> (Float, [Int16])? {
        guard let description = CMSampleBufferGetFormatDescription(buffer),
              let format = CMAudioFormatDescriptionGetStreamBasicDescription(description)?.pointee,
              format.mFormatID == kAudioFormatLinearPCM else { return nil }
        let frames = CMSampleBufferGetNumSamples(buffer)
        guard frames > 0 else { return nil }
        var size = 0
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            buffer, bufferListSizeNeededOut: &size, bufferListOut: nil, bufferListSize: 0,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)
        guard size > 0 else { return nil }
        let memory = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { memory.deallocate() }
        let list = memory.bindMemory(to: AudioBufferList.self, capacity: 1)
        var block: CMBlockBuffer?
        guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            buffer, bufferListSizeNeededOut: nil, bufferListOut: list, bufferListSize: size,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: &block) == noErr else { return nil }
        let buffers = UnsafeMutableAudioBufferListPointer(list).map {
            UnsafeRawBufferPointer(start: $0.mData, count: Int($0.mDataByteSize))
        }
        let flags = format.mFormatFlags
        let samples = PhoneAudioPacket.downmix(
            buffers, frames: frames, channels: Int(format.mChannelsPerFrame), bitsPerChannel: Int(format.mBitsPerChannel),
            isFloat: flags & kAudioFormatFlagIsFloat != 0, bigEndian: flags & kAudioFormatFlagIsBigEndian != 0,
            nonInterleaved: flags & kAudioFormatFlagIsNonInterleaved != 0)
        withExtendedLifetime(block) {}
        guard let mono = samples else { return nil }
        return (Float(format.mSampleRate), mono)
    }
}
