import AVFoundation
import Network
import ReplayKit
import UIKit
import UniformTypeIdentifiers

/// Where the visuals' audio comes from.
enum GhostAudioSource: String {
    case off
    /// The microphone, listening without stopping music other apps play.
    case mic
    /// Ghost Arcade's own player: the user's audio files and video soundtracks.
    case player
    /// Other apps' sound, sent by the screen-broadcast extension over loopback.
    case phone
}

struct GhostAudioTrack: Codable {
    let id: String
    var name: String
    var file: String
    var duration: Double
}

/// Native audio for the visuals. One source at a time feeds AudioAnalysisCore;
/// the web layer reads analysis frames from ghostcapture://audio/frame and turns
/// them into the shader audio uniforms, exactly as it did with the web microphone.
final class GhostAudio: NSObject {
    static let shared = GhostAudio()
    static let broadcastExtension = "com.ghostarcade.mobile.AudioBroadcast"

    let analysis = AudioAnalysisCore()
    private(set) var source: GhostAudioSource = .off
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var tappedNode: AVAudioNode?
    private var frameSequence: UInt32 = 0
    /// While a video take records, this hears what the visuals hear (the player's mix or the microphone).
    private let takeLock = NSLock()
    private var takeListener: ((AVAudioPCMBuffer, AVAudioTime) -> Void)?

    // Player
    private(set) var tracks: [GhostAudioTrack] = []
    private var currentIndex: Int?
    private var currentFile: AVAudioFile?
    private var segmentStart: AVAudioFramePosition = 0
    private var scheduleToken = 0
    private var scheduled = false
    private var pausedAt: Double = 0
    private(set) var playing = false
    var loopAll = true

    // Phone audio (broadcast extension)
    private var listener: NWListener?
    private var connections: [NWConnection] = []
    private let phoneLock = NSLock()
    private var lastPhonePacketTime: TimeInterval = 0
    private var picker: RPSystemBroadcastPickerView?
    private let networkQueue = DispatchQueue(label: "ghost.audio.phone")

    private override init() {
        super.init()
        tracks = Self.loadTracks()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        center.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(mediaReset), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
    }

    // MARK: Source

    func setSource(_ next: GhostAudioSource, completion: @escaping (String?) -> Void) {
        let apply = { [weak self] in
            guard let self = self else { return }
            // Asking again for the running source (the web layer reloading) keeps it,
            // so the player does not stop.
            if next == self.source, self.running { completion(nil); return }
            do {
                try self.switchTo(next)
                completion(nil)
            } catch {
                self.stopEngine()
                self.source = .off
                completion(error.localizedDescription)
            }
        }
        guard next == .mic else { DispatchQueue.main.async(execute: apply); return }
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                if granted { apply() } else { completion("Microphone access is off. Turn it on for Ghost Arcade in Settings.") }
            }
        }
    }

    private func switchTo(_ next: GhostAudioSource) throws {
        stopEngine()
        stopPhoneListener()
        if source != next { analysis.reset() }
        source = next
        let session = AVAudioSession.sharedInstance()
        switch next {
        case .off:
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
        case .mic:
            // playAndRecord + mixWithOthers keeps Spotify, Music and the rest playing
            // through the speaker or headphones while the mic listens to the room.
            try session.setCategory(.playAndRecord, mode: .default,
                                    options: [.mixWithOthers, .defaultToSpeaker, .allowBluetoothA2DP, .allowAirPlay])
            try session.setActive(true)
            try startEngine(tapping: engine.inputNode)
        case .player:
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
            attachPlayerIfNeeded()
            try startEngine(tapping: engine.mainMixerNode)
        case .phone:
            // Nothing to capture here: the extension sends samples. Mixing with
            // others so the app never silences the music it is listening to.
            try? session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
            try startPhoneListener()
        }
    }

    private func startEngine(tapping node: AVAudioNode) throws {
        let format = node.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(domain: "GhostAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "No audio input is available."])
        }
        let rate = Float(format.sampleRate)
        node.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, when in
            guard let self = self, let channels = buffer.floatChannelData else { return }
            self.takeLock.lock(); let listener = self.takeListener; self.takeLock.unlock()
            listener?(buffer, when)
            let count = Int(buffer.frameLength)
            let channelCount = Int(buffer.format.channelCount)
            guard count > 0 else { return }
            var mono = [Float](repeating: 0, count: count)
            for c in 0..<channelCount {
                let data = channels[c]
                for i in 0..<count { mono[i] += data[i] }
            }
            if channelCount > 1 { for i in 0..<count { mono[i] /= Float(channelCount) } }
            self.analysis.push(mono, rate: rate)
        }
        tappedNode = node
        engine.prepare()
        try engine.start()
    }

    private func stopEngine() {
        tappedNode?.removeTap(onBus: 0)
        tappedNode = nil
        if engine.isRunning { engine.stop() }
        if scheduled { pausedAt = position() }
        player.stop()
        scheduled = false
        playing = false
    }

    /// Starts (or with nil, stops) handing the analysed sound to a recording. Called on any thread.
    func setTakeListener(_ listener: ((AVAudioPCMBuffer, AVAudioTime) -> Void)?) {
        takeLock.lock(); takeListener = listener; takeLock.unlock()
    }

    // MARK: Analysis frames for the web layer

    /// "GAAF", sequence, source code, sample rate, flags (bit 0: audio is arriving),
    /// then the byte spectrum (512) and the byte waveform (1024). Nil when off.
    func frameData() -> Data? {
        guard source != .off else { return nil }
        let frame = analysis.frame()
        frameSequence &+= 1
        let code: UInt32 = source == .mic ? 1 : source == .player ? 2 : 3
        var data = Data(capacity: 20 + frame.spectrum.count + frame.waveform.count)
        for value in [UInt32(0x4741_4146), frameSequence, code, analysis.sampleRate.bitPattern, arriving ? 1 : 0] {
            var v = value.littleEndian
            withUnsafeBytes(of: &v) { data.append(contentsOf: $0) }
        }
        data.append(contentsOf: frame.spectrum)
        data.append(contentsOf: frame.waveform)
        return data
    }

    private var running: Bool {
        switch source {
        case .off: return true
        case .mic, .player: return engine.isRunning
        case .phone: return listener != nil
        }
    }

    /// Whether the current source is delivering sound right now.
    var arriving: Bool {
        switch source {
        case .off: return false
        case .mic: return engine.isRunning
        case .player: return engine.isRunning && playing
        case .phone: return phoneSilence() < 1
        }
    }

    func status() -> [String: Any] {
        var result: [String: Any] = [
            "source": source.rawValue,
            "arriving": arriving,
            "playing": playing,
            "loop": loopAll,
            "tracks": tracks.map { ["id": $0.id, "name": $0.name, "duration": $0.duration] },
            "phoneSupported": true,
        ]
        if let index = currentIndex, tracks.indices.contains(index) {
            result["trackId"] = tracks[index].id
            result["position"] = position()
        }
        let silence = phoneSilence()
        if silence.isFinite { result["phoneSilentFor"] = silence }
        return result
    }

    // MARK: Player

    private func attachPlayerIfNeeded() {
        if player.engine == nil { engine.attach(player) }
    }

    func playerCommand(_ action: String, id: String?, position: Double?, loop: Bool?) throws {
        if let loop = loop { loopAll = loop }
        switch action {
        case "play":
            if let id = id, let index = tracks.firstIndex(where: { $0.id == id }), index != currentIndex || position != nil {
                try play(index: index, from: position ?? 0, resume: false)
            } else if let index = currentIndex {
                if scheduled && engine.isRunning && source == .player { player.play(); playing = true }
                else { try play(index: index, from: pausedAt, resume: false) }
            } else if !tracks.isEmpty {
                try play(index: 0, from: 0, resume: false)
            }
        case "pause":
            pausedAt = self.position()
            player.pause(); playing = false
        case "next":
            guard !tracks.isEmpty else { return }
            try play(index: ((currentIndex ?? -1) + 1) % tracks.count, from: 0, resume: false)
        case "previous":
            guard !tracks.isEmpty else { return }
            try play(index: ((currentIndex ?? 1) - 1 + tracks.count) % tracks.count, from: 0, resume: false)
        case "seek":
            if let index = currentIndex { try play(index: index, from: position ?? 0, resume: !playing) }
            else if let id = id, let index = tracks.firstIndex(where: { $0.id == id }) { try play(index: index, from: position ?? 0, resume: true) }
        case "loop":
            break
        default:
            throw NSError(domain: "GhostAudio", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unknown player action."])
        }
    }

    private func play(index: Int, from seconds: Double, resume paused: Bool) throws {
        guard tracks.indices.contains(index) else { return }
        if source != .player { try switchTo(.player) }
        let url = try Self.folder().appendingPathComponent(tracks[index].file)
        let file = try AVAudioFile(forReading: url)
        attachPlayerIfNeeded()
        player.stop()
        engine.disconnectNodeOutput(player)
        engine.connect(player, to: engine.mainMixerNode, format: file.processingFormat)
        if !engine.isRunning { try engine.start() }
        let rate = file.processingFormat.sampleRate
        let start = AVAudioFramePosition(max(0, min(seconds, Double(file.length) / rate - 0.05)) * rate)
        let frames = AVAudioFrameCount(max(0, file.length - start))
        currentIndex = index
        currentFile = file
        segmentStart = start
        pausedAt = Double(start) / rate
        scheduleToken += 1
        let token = scheduleToken
        guard frames > 0 else { return }
        player.scheduleSegment(file, startingFrame: start, frameCount: frames, at: nil,
                               completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self, token == self.scheduleToken, self.playing else { return }
                if self.loopAll || index + 1 < self.tracks.count {
                    try? self.play(index: (index + 1) % max(1, self.tracks.count), from: 0, resume: false)
                } else {
                    self.playing = false
                }
            }
        }
        scheduled = true
        if paused { playing = false } else { player.play(); playing = true }
    }

    private func position() -> Double {
        guard let file = currentFile else { return 0 }
        let rate = file.processingFormat.sampleRate
        if playing, let nodeTime = player.lastRenderTime, let playerTime = player.playerTime(forNodeTime: nodeTime) {
            return min(Double(file.length) / rate, Double(segmentStart + playerTime.sampleTime) / rate)
        }
        return pausedAt
    }

    // MARK: Track library

    static func folder() throws -> URL {
        let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let folder = base.appendingPathComponent("GhostAudio", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    private static func loadTracks() -> [GhostAudioTrack] {
        guard let folder = try? folder(), let data = try? Data(contentsOf: folder.appendingPathComponent("tracks.json")),
              let list = try? JSONDecoder().decode([GhostAudioTrack].self, from: data) else { return [] }
        return list.filter { FileManager.default.fileExists(atPath: folder.appendingPathComponent($0.file).path) }
    }

    private func saveTracks() {
        guard let folder = try? Self.folder(), let data = try? JSONEncoder().encode(tracks) else { return }
        try? data.write(to: folder.appendingPathComponent("tracks.json"), options: .atomic)
    }

    func removeTrack(id: String) {
        guard let index = tracks.firstIndex(where: { $0.id == id }) else { return }
        if currentIndex == index { player.stop(); scheduled = false; playing = false; currentIndex = nil; currentFile = nil; pausedAt = 0; scheduleToken += 1 }
        else if let current = currentIndex, current > index { currentIndex = current - 1 }
        if let folder = try? Self.folder() { try? FileManager.default.removeItem(at: folder.appendingPathComponent(tracks[index].file)) }
        tracks.remove(at: index)
        saveTracks()
    }

    /// Copy picked audio into the library; a video contributes its soundtrack.
    func importFiles(_ urls: [URL], completion: @escaping (_ added: Int, _ skipped: [String]) -> Void) {
        let group = DispatchGroup()
        var added: [GhostAudioTrack] = []
        var skipped: [String] = []
        let lock = NSLock()
        for url in urls {
            group.enter()
            let name = url.deletingPathExtension().lastPathComponent
            let id = UUID().uuidString
            let finish: (GhostAudioTrack?) -> Void = { track in
                lock.lock()
                if let track = track { added.append(track) } else { skipped.append(url.lastPathComponent) }
                lock.unlock()
                group.leave()
            }
            guard let folder = try? Self.folder() else { finish(nil); continue }
            let type = UTType(filenameExtension: url.pathExtension.lowercased())
            if let type = type, type.conforms(to: .movie) || type.conforms(to: .audiovisualContent) && !type.conforms(to: .audio) {
                let target = folder.appendingPathComponent(id + ".m4a")
                let asset = AVURLAsset(url: url)
                guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else { finish(nil); continue }
                export.outputURL = target
                export.outputFileType = .m4a
                export.exportAsynchronously {
                    guard export.status == .completed, let duration = Self.duration(of: target) else {
                        try? FileManager.default.removeItem(at: target); finish(nil); return
                    }
                    finish(GhostAudioTrack(id: id, name: name, file: target.lastPathComponent, duration: duration))
                }
            } else {
                let target = folder.appendingPathComponent(id + "." + (url.pathExtension.isEmpty ? "m4a" : url.pathExtension.lowercased()))
                do {
                    try FileManager.default.copyItem(at: url, to: target)
                    guard let duration = Self.duration(of: target) else { try? FileManager.default.removeItem(at: target); finish(nil); continue }
                    finish(GhostAudioTrack(id: id, name: name, file: target.lastPathComponent, duration: duration))
                } catch { finish(nil) }
            }
        }
        group.notify(queue: .main) {
            self.tracks.append(contentsOf: added.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending })
            self.saveTracks()
            completion(added.count, skipped)
        }
    }

    private static func duration(of url: URL) -> Double? {
        guard let file = try? AVAudioFile(forReading: url), file.length > 0 else { return nil }
        return Double(file.length) / file.processingFormat.sampleRate
    }

    // MARK: Phone audio

    private func startPhoneListener() throws {
        let parameters = NWParameters.udp
        parameters.requiredInterfaceType = .loopback
        parameters.acceptLocalOnly = true
        parameters.allowLocalEndpointReuse = true
        guard let port = NWEndpoint.Port(rawValue: PhoneAudioPacket.port) else { return }
        let listener = try NWListener(using: parameters, on: port)
        listener.newConnectionHandler = { [weak self] connection in
            guard let self = self else { return }
            self.connections.append(connection)
            connection.start(queue: self.networkQueue)
            self.receive(on: connection)
        }
        // iOS can take a listening socket back while the app is in the background.
        listener.stateUpdateHandler = { [weak self, weak listener] state in
            guard case .failed = state else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                guard let self = self, self.source == .phone, self.listener === listener else { return }
                self.restartPhoneListener()
            }
        }
        listener.start(queue: networkQueue)
        self.listener = listener
    }

    private func restartPhoneListener() {
        stopPhoneListener()
        try? startPhoneListener()
    }

    private func receive(on connection: NWConnection) {
        connection.receiveMessage { [weak self] data, _, _, error in
            guard let self = self else { return }
            if let data = data, let packet = PhoneAudioPacket.decode(data) {
                self.analysis.push(packet.samples, rate: packet.rate)
                self.phoneLock.lock(); self.lastPhonePacketTime = Date().timeIntervalSince1970; self.phoneLock.unlock()
            }
            if error == nil, self.source == .phone { self.receive(on: connection) }
        }
    }

    /// Seconds since the extension last sent sound; infinity when it never has.
    private func phoneSilence() -> Double {
        phoneLock.lock(); defer { phoneLock.unlock() }
        return lastPhonePacketTime > 0 ? Date().timeIntervalSince1970 - lastPhonePacketTime : .infinity
    }

    private func stopPhoneListener() {
        listener?.cancel(); listener = nil
        for connection in connections { connection.cancel() }
        connections.removeAll()
    }

    /// Show the system "Start Broadcast" sheet with Ghost Arcade's audio extension picked.
    func presentBroadcastPicker(in view: UIView) {
        picker?.removeFromSuperview()
        let picker = RPSystemBroadcastPickerView(frame: CGRect(x: -100, y: -100, width: 44, height: 44))
        picker.preferredExtension = Self.broadcastExtension
        picker.showsMicrophoneButton = false
        picker.alpha = 0.01
        view.addSubview(picker)
        self.picker = picker
        for case let button as UIButton in picker.subviews {
            button.sendActions(for: .touchUpInside)
        }
    }

    // MARK: Lifecycle

    @objc private func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
        DispatchQueue.main.async { self.resume() }
    }

    @objc private func becameActive() { resume() }

    @objc private func mediaReset() { DispatchQueue.main.async { self.resume() } }

    private func resume() {
        if source == .phone { restartPhoneListener(); return }
        guard source == .mic || source == .player, !engine.isRunning else { return }
        let wasPlaying = playing
        let at = position()
        try? switchTo(source)
        if source == .player, wasPlaying, let index = currentIndex { try? play(index: index, from: at, resume: false) }
    }
}
