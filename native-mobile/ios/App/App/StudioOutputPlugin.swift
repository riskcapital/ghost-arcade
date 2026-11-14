import UIKit
import AVKit
import AVFoundation
import Photos
import StoreKit
import Capacitor

/// Output, recording and review prompt for the standalone studio.
///
///   showRoutePicker({ anchor? }) -> { shown, airplay, name }
///     Opens the system AirPlay picker in the app, pointed at `anchor` (web view points) on iPad.
///     Resolves as soon as the list shows (`shown` true) or could not open (`shown` false); the
///     display itself arrives later as a 'ghost-external-display' event.
///   routeStatus() -> { airplay, name }        the AirPlay device the app's sound goes to, if any
///   recordingBegin({ mimeType, sound?, clock? }) -> { id, sound }
///     `sound` true records what the visuals hear: the in-app player's mix or the microphone. The answer
///     names the source ('player', 'mic', 'phone', 'off'); only the player and the microphone are
///     recorded, anything else gives a silent sound track. `clock` is the web layer's wall clock in ms.
///   recordingVideoStarted({ id, at, clock }) -> {}   web wall-clock ms when the video started, and now
///   recordingAppend({ id, base64 }) -> { bytes }
///   recordingFinish({ id, filename }) -> { id, path, bytes, durationMs, width, height, sound }
///     Closes the file and writes a plain MP4 that Photos and every share target accept, with the sound
///     laid against the picture by the wall clock. `sound` is true when the file has a sound track.
///   recordingDiscard({ id }) -> {}
///   recordingSaveToPhotos({ id }) -> { saved }  asks for add-only Photos access the first time
///   recordingShare({ id, anchor? }) -> { completed }
///   presentMode({ on }) -> {}                    dims this screen to its lowest level during a show, and restores it
///   requestReview() -> { requested }            the system rating prompt; iOS decides whether it shows
///   appVersion() -> { version, build }
@objc(StudioOutputPlugin)
public final class StudioOutputPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StudioOutputPlugin"
    public let jsName = "StudioOutput"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "showRoutePicker", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "routeStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recordingBegin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recordingAppend", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recordingVideoStarted", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recordingFinish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recordingDiscard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recordingSaveToPhotos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recordingShare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appVersion", returnType: CAPPluginReturnPromise)
    ]

    public override func load() {
        // Nothing is being recorded at launch: clear recordings left by an earlier run.
        DispatchQueue.global(qos: .utility).async { Recordings.purge() }
    }

    // MARK: AirPlay picker

    private var routePicker: RoutePicker?

    @objc func showRoutePicker(_ call: CAPPluginCall) {
        let anchor = Self.rect(call.getObject("anchor"))
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController, let view = host.view, view.window != nil else { call.reject("The display picker is not available right now."); return }
            guard host.presentedViewController == nil else { call.reject("Close the other native tool first."); return }
            // A picker from an earlier tap that never reported back is replaced, never stacked.
            self.routePicker?.close()
            let picker = RoutePicker(in: view, anchor: anchor)
            self.routePicker = picker
            picker.open(answer: { shown in
                NSLog("[GhostOutput] AirPlay picker %@", shown ? "opened" : "did not open")
                var result = Self.airPlayRoute()
                result["shown"] = shown
                call.resolve(result)
            }, closed: { [weak self, weak picker] in
                NSLog("[GhostOutput] AirPlay picker closed")
                if let self = self, self.routePicker === picker { self.routePicker = nil }
            })
        }
    }

    @objc func routeStatus(_ call: CAPPluginCall) { DispatchQueue.main.async { call.resolve(Self.airPlayRoute()) } }

    private static func airPlayRoute() -> [String: Any] {
        let route = AVAudioSession.sharedInstance().currentRoute.outputs.first { $0.portType == .airPlay }
        return ["airplay": route != nil, "name": route?.portName ?? ""]
    }

    // MARK: Recording

    private let files = DispatchQueue(label: "ghost.recordings")
    private var writing: [String: FileHandle] = [:] // only touched on `files`
    private var takes: [String: Take] = [:]         // only touched on `files`

    /// The sound of one take and the clocks needed to lay it against the picture.
    private final class Take {
        let sound: TakeSound?
        /// Native wall clock minus the web layer's, in seconds (the smallest seen: bridge delay only adds).
        var skew: Double?
        var videoStart: Double?
        init(sound: TakeSound?) { self.sound = sound }
        func noteClock(_ webMs: Double?) {
            guard let webMs = webMs, webMs.isFinite, webMs > 0 else { return }
            let measured = Date().timeIntervalSince1970 - webMs / 1000
            skew = min(skew ?? measured, measured)
        }
    }

    @objc func recordingBegin(_ call: CAPPluginCall) {
        let ext = (call.getString("mimeType") ?? "").contains("webm") ? "webm" : "mp4"
        let wantsSound = call.getBool("sound") ?? false
        let clock = call.getDouble("clock")
        // The audio engine and its source belong to the main thread.
        DispatchQueue.main.async {
            let source = GhostAudio.shared.source
            let id = UUID().uuidString
            let folder = Recordings.folder(id)
            var sound: TakeSound?
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                // Only the player's own mix and the microphone are recorded. Other apps' sound arrives
                // through the screen broadcast and is never written to a file.
                if wantsSound, source == .player || source == .mic {
                    let take = try TakeSound(url: folder.appendingPathComponent("capture-sound.caf"))
                    GhostAudio.shared.setTakeListener { buffer, when in take.append(buffer, at: when) }
                    sound = take
                }
            } catch {
                NSLog("[GhostRecord] sound not recorded: %@", error.localizedDescription)
            }
            let take = Take(sound: sound)
            take.noteClock(clock)
            self.files.async {
                let raw = folder.appendingPathComponent("capture.\(ext)")
                do {
                    guard FileManager.default.createFile(atPath: raw.path, contents: nil) else { throw Recordings.failure("The recording could not be stored.") }
                    self.writing[id] = try FileHandle(forWritingTo: raw)
                    self.takes[id] = take
                    call.resolve(["id": id, "sound": source.rawValue, "recordsSound": sound != nil])
                } catch {
                    if sound != nil { GhostAudio.shared.setTakeListener(nil) }
                    try? FileManager.default.removeItem(at: folder); call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc func recordingVideoStarted(_ call: CAPPluginCall) {
        guard let id = Recordings.id(call), let at = call.getDouble("at") else { call.reject("Unknown recording."); return }
        files.async {
            guard let take = self.takes[id] else { call.reject("Unknown recording."); return }
            // A second look at the clocks; the smaller difference has less bridge delay in it.
            take.noteClock(call.getDouble("clock"))
            take.videoStart = at / 1000
            call.resolve()
        }
    }

    @objc func recordingAppend(_ call: CAPPluginCall) {
        guard let id = Recordings.id(call), var text = call.getString("base64"), !text.isEmpty else { call.reject("Nothing to add to the recording."); return }
        if text.hasPrefix("data:"), let comma = text.firstIndex(of: ",") { text = String(text[text.index(after: comma)...]) }
        guard let data = Data(base64Encoded: text, options: .ignoreUnknownCharacters) else { call.reject("The recording data could not be read."); return }
        files.async {
            guard let handle = self.writing[id] else { call.reject("This recording has already ended."); return }
            do {
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
                let bytes = try handle.offset()
                // A phone's storage is finite; a single take never needs more than this.
                guard bytes <= 4_000_000_000 else { call.reject("The recording is too large."); return }
                call.resolve(["bytes": bytes])
            } catch { call.reject(Recordings.storageMessage(error)) }
        }
    }

    @objc func recordingFinish(_ call: CAPPluginCall) {
        guard let id = Recordings.id(call) else { call.reject("Unknown recording."); return }
        let name = Recordings.filename(call.getString("filename"))
        files.async {
            guard let handle = self.writing.removeValue(forKey: id) else { call.reject("This recording has already ended."); return }
            try? handle.close()
            let take = self.takes.removeValue(forKey: id)
            if take?.sound != nil { GhostAudio.shared.setTakeListener(nil) }
            let folder = Recordings.folder(id)
            guard let raw = Recordings.capture(in: folder) else { call.reject("The recording is empty."); return }
            let final = folder.appendingPathComponent(name)
            // The web clock's video start, moved onto this clock.
            let videoStart = take.flatMap { t in t.videoStart.map { $0 + (t.skew ?? 0) } }
            Recordings.finalize(raw, sound: take?.sound, videoStart: videoStart, to: final) { result in
                switch result {
                case .success(let info): call.resolve(info.merging(["id": id]) { a, _ in a })
                case .failure(let error): call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc func recordingDiscard(_ call: CAPPluginCall) {
        guard let id = Recordings.id(call) else { call.resolve(); return }
        files.async {
            try? self.writing.removeValue(forKey: id)?.close()
            if let take = self.takes.removeValue(forKey: id), take.sound != nil { GhostAudio.shared.setTakeListener(nil); _ = take.sound?.close() }
            try? FileManager.default.removeItem(at: Recordings.folder(id))
            call.resolve()
        }
    }

    @objc func recordingSaveToPhotos(_ call: CAPPluginCall) {
        guard let id = Recordings.id(call), let file = Recordings.finished(id) else { call.reject("The recording is no longer on this device."); return }
        let save = {
            PHPhotoLibrary.shared().performChanges({
                PHAssetCreationRequest.forAsset().addResource(with: .video, fileURL: file, options: nil)
            }) { saved, error in
                if saved { call.resolve(["saved": true]) } else { call.reject(error?.localizedDescription ?? "Photos did not accept the video.") }
            }
        }
        switch PHPhotoLibrary.authorizationStatus(for: .addOnly) {
        case .authorized, .limited: save()
        case .notDetermined:
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                if status == .authorized || status == .limited { save() } else { call.reject("Ghost Arcade can't add to Photos. Allow it in Settings > Ghost Arcade > Photos.") }
            }
        default: call.reject("Ghost Arcade can't add to Photos. Allow it in Settings > Ghost Arcade > Photos.")
        }
    }

    @objc func recordingShare(_ call: CAPPluginCall) {
        guard let id = Recordings.id(call), let file = Recordings.finished(id) else { call.reject("The recording is no longer on this device."); return }
        let anchor = Self.rect(call.getObject("anchor"))
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController, host.viewIfLoaded?.window != nil else { call.reject("Sharing is not available right now."); return }
            guard host.presentedViewController == nil else { call.reject("Close the other native tool before sharing."); return }
            let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            if let popover = sheet.popoverPresentationController {
                // iPad shows the sheet as a popover, which must be anchored inside the window.
                let bounds = host.view.bounds
                popover.sourceView = host.view
                if let anchor = anchor?.intersection(bounds), !anchor.isNull, anchor.width >= 1, anchor.height >= 1 {
                    popover.sourceRect = anchor
                } else {
                    popover.sourceRect = CGRect(x: bounds.midX, y: bounds.midY, width: 1, height: 1)
                    popover.permittedArrowDirections = []
                }
            }
            var answered = false
            sheet.completionWithItemsHandler = { _, completed, _, error in
                guard !answered else { return }
                answered = true
                if let error = error { call.reject(error.localizedDescription) } else { call.resolve(["completed": completed]) }
            }
            host.present(sheet, animated: true)
        }
    }

    // MARK: Present mode

    private let presenter = PresentDimmer()

    @objc func presentMode(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            self.presenter.set(on, screen: self.bridge?.viewController?.view.window?.windowScene?.screen)
            call.resolve()
        }
    }

    // MARK: Review prompt

    @objc func requestReview(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let scene = self.bridge?.viewController?.view.window?.windowScene, scene.activationState == .foregroundActive else {
                call.resolve(["requested": false]); return
            }
            AppStore.requestReview(in: scene)
            call.resolve(["requested": true])
        }
    }

    @objc func appVersion(_ call: CAPPluginCall) {
        let info = Bundle.main.infoDictionary ?? [:]
        call.resolve(["version": info["CFBundleShortVersionString"] as? String ?? "", "build": info["CFBundleVersion"] as? String ?? ""])
    }

    // MARK: Helpers

    /// A rectangle in web view points, as sent by the web layer.
    private static func rect(_ box: JSObject?) -> CGRect? {
        guard let box = box else { return nil }
        let value = { (key: String) in (box[key] as? NSNumber)?.doubleValue }
        guard let x = value("x"), let y = value("y"), let width = value("width"), let height = value("height"),
              [x, y, width, height].allSatisfy({ $0.isFinite }) else { return nil }
        return CGRect(x: x, y: y, width: width, height: height)
    }
}

/// Present mode turns this screen down so the phone does not glow in a dark room, and gives the
/// person's own brightness back when it ends or the app leaves the foreground.
private final class PresentDimmer {
    private var on = false
    private var saved: CGFloat?
    private weak var screen: UIScreen?
    private var observers: [NSObjectProtocol] = []

    init() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.restore() })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.dim() })
    }
    deinit { observers.forEach(NotificationCenter.default.removeObserver) }

    func set(_ value: Bool, screen: UIScreen?) {
        if let screen = screen { self.screen = screen }
        on = value
        if on { dim() } else { restore() }
    }
    private func dim() {
        guard on, let screen = screen else { return }
        if saved == nil { saved = screen.brightness }
        screen.brightness = 0
    }
    private func restore() {
        guard let saved = saved else { return }
        screen?.brightness = saved
        self.saved = nil
    }
}

/// The system AirPlay picker, opened from a web button. AVRoutePickerView only opens from its own
/// button, so one is placed over the tapped control and its button is pressed. The picker lists
/// Apple TVs, AirPlay projectors and Macs; choosing one makes the display available to the app.
private final class RoutePicker: NSObject, AVRoutePickerViewDelegate {
    private let view: AVRoutePickerView
    /// Answers the web layer once: true when the list started to show, false when it did not.
    private var answer: ((Bool) -> Void)?
    private var closed: (() -> Void)?

    init(in host: UIView, anchor: CGRect?) {
        let frame = anchor.flatMap { $0.intersection(host.bounds).isNull ? nil : $0.intersection(host.bounds) }
            ?? CGRect(x: host.bounds.midX - 22, y: host.bounds.midY - 22, width: 44, height: 44)
        view = AVRoutePickerView(frame: frame)
        super.init()
        view.prioritizesVideoDevices = true
        view.delegate = self
        // Present but not seen: the web button underneath stays the visible control.
        view.alpha = 0.02
        view.isUserInteractionEnabled = false
        host.addSubview(view)
    }

    func open(answer: @escaping (Bool) -> Void, closed: @escaping () -> Void) {
        self.answer = answer
        self.closed = closed
        guard let button = Self.button(in: view) else { reply(false); close(); return }
        button.sendActions(for: .touchUpInside)
        // If the system did not start showing the list, say so instead of waiting.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self = self, self.answer != nil else { return }
            self.reply(false)
            self.close()
        }
    }

    func routePickerViewWillBeginPresentingRoutes(_ routePickerView: AVRoutePickerView) { reply(true) }
    func routePickerViewDidEndPresentingRoutes(_ routePickerView: AVRoutePickerView) { close() }

    private func reply(_ shown: Bool) { let answer = self.answer; self.answer = nil; answer?(shown) }
    func close() {
        reply(false)
        view.removeFromSuperview()
        let closed = self.closed; self.closed = nil; closed?()
    }

    private static func button(in view: UIView) -> UIButton? {
        for child in view.subviews {
            if let button = child as? UIButton { return button }
            if let button = button(in: child) { return button }
        }
        return nil
    }
}

/// Recordings live in their own temporary folder until they are saved or shared, and go at the next launch.
private enum Recordings {
    static func root() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("GhostRecordings", isDirectory: true) }
    static func purge() { try? FileManager.default.removeItem(at: root()) }
    static func folder(_ id: String) -> URL { root().appendingPathComponent(id, isDirectory: true) }
    static func failure(_ message: String) -> NSError { NSError(domain: "GhostRecording", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }

    /// Only ids this plugin made: a UUID can never point outside the recordings folder.
    static func id(_ call: CAPPluginCall) -> String? {
        guard let id = call.getString("id"), UUID(uuidString: id) != nil else { return nil }
        return id
    }
    static func capture(in folder: URL) -> URL? {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.fileSizeKey])) ?? []
        return files.first { $0.lastPathComponent.hasPrefix("capture.") && ((try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) > 0 }
    }
    static func finished(_ id: String) -> URL? {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder(id), includingPropertiesForKeys: nil)) ?? []
        return files.first { !$0.lastPathComponent.hasPrefix("capture") }
    }
    static func filename(_ raw: String?) -> String {
        var stem = ((raw ?? "") as NSString).deletingPathExtension
        stem = (stem as NSString).lastPathComponent
        stem = stem.components(separatedBy: CharacterSet.controlCharacters.union(CharacterSet(charactersIn: "/\\:*?\"<>|"))).joined()
        stem = stem.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
        if stem.isEmpty { stem = "Ghost Arcade" }
        return String(stem.prefix(80)) + ".mp4"
    }
    static func storageMessage(_ error: Error) -> String {
        let code = (error as NSError).code
        if code == NSFileWriteOutOfSpaceError || code == Int(ENOSPC) { return "This device is out of storage. The recording stopped." }
        return error.localizedDescription
    }

    /// Writes the captured stream as a plain MP4 (same video frames, no re-encode) and measures it.
    /// With a take's sound, the sound is laid against the picture by the wall clock and encoded as AAC;
    /// a take that heard nothing gets a silent sound track of the same length.
    static func finalize(_ raw: URL, sound: TakeSound?, videoStart: Double?, to final: URL, done: @escaping (Result<[String: Any], Error>) -> Void) {
        Task {
            do {
                let folder = raw.deletingLastPathComponent()
                let written = sound?.close()
                defer { if let written = written { try? FileManager.default.removeItem(at: written.url) } }
                // The capture is a fragmented stream; first copy its frames into a plain MP4, which can
                // then be combined with the sound.
                let plain = folder.appendingPathComponent("capture-picture.mp4")
                try? FileManager.default.removeItem(at: plain)
                try? FileManager.default.removeItem(at: final)
                var picture = raw
                if await remux(AVURLAsset(url: raw), to: plain) { picture = plain; try? FileManager.default.removeItem(at: raw) }
                let asset = AVURLAsset(url: picture)
                guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw failure("The recording has no picture.") }
                let size = try await track.load(.naturalSize)
                let span = try await track.load(.timeRange)
                var output = final
                var withSound = false
                if picture == plain, span.duration.isNumeric, span.duration.seconds > 0 {
                    let laid = folder.appendingPathComponent("capture-sound.m4a")
                    // Frame 0 of the file is the first captured frame, `span.start` after the video began.
                    let firstFrame = videoStart.map { $0 + (span.start.isNumeric ? span.start.seconds : 0) }
                    if let laidOut = await laySound(written, videoStart: firstFrame, length: span.duration, folder: folder, to: laid) {
                        withSound = await mux(video: track, span: span, sound: laidOut, to: final)
                        if !withSound { try? FileManager.default.removeItem(at: final) }
                    }
                    try? FileManager.default.removeItem(at: laid)
                }
                if withSound {
                    try? FileManager.default.removeItem(at: picture)
                } else {
                    // The picture alone: the plain copy, or the capture itself when even that failed.
                    output = picture == plain ? final : final.deletingPathExtension().appendingPathExtension(raw.pathExtension)
                    try FileManager.default.moveItem(at: picture, to: output)
                }
                let duration = try await AVURLAsset(url: output).load(.duration)
                let bytes = (try? output.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                done(.success([
                    "path": output.path,
                    "bytes": bytes,
                    "durationMs": duration.isNumeric ? Int((duration.seconds * 1000).rounded()) : 0,
                    "width": Int(abs(size.width)),
                    "height": Int(abs(size.height)),
                    "sound": withSound
                ]))
            } catch {
                done(.failure(error))
            }
        }
    }

    /// The take's sound cut to the picture's timeline and encoded as AAC: sample 0 of the result plays
    /// with video frame 0. Silence when nothing was heard.
    private static func laySound(_ written: TakeSound.Written?, videoStart: Double?, length: CMTime, folder: URL, to url: URL) async -> URL? {
        var source = written
        if source?.start == nil || videoStart == nil || (source?.seconds ?? 0) <= 0 {
            // Nothing heard (or no clock): a silent track keeps every player and share target happy.
            guard let silent = try? TakeSound(url: folder.appendingPathComponent("capture-silence.caf")) else { return nil }
            silent.padTo(seconds: length.seconds)
            source = silent.close()
            source?.start = videoStart ?? 0
        }
        guard let sound = source, let start = sound.start else { NSLog("[GhostRecord] no sound to lay"); return nil }
        defer { if sound.url.lastPathComponent == "capture-silence.caf" { try? FileManager.default.removeItem(at: sound.url) } }
        let asset = AVURLAsset(url: sound.url)
        guard let track = try? await asset.loadTracks(withMediaType: .audio).first else { NSLog("[GhostRecord] the sound file has no track"); return nil }
        let composition = AVMutableComposition()
        guard let lane = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { return nil }
        let scale: CMTimeScale = 48_000
        // Where the sound starts relative to the picture. The sound is begun first, so this is normally
        // negative and the sound's head is cut; a positive offset leads with silence.
        let offset = start - (videoStart ?? start)
        let soundLength = CMTime(seconds: sound.seconds, preferredTimescale: scale)
        let from = CMTime(seconds: max(0, -offset), preferredTimescale: scale)
        let at = CMTime(seconds: max(0, offset), preferredTimescale: scale)
        let take = CMTimeMinimum(CMTimeSubtract(soundLength, from), CMTimeSubtract(length, at))
        NSLog("[GhostRecord] sound %.3f s, starts %.3f s from the picture (%.3f s long)", sound.seconds, offset, length.seconds)
        guard take.seconds > 0 else { return nil }
        do { try lane.insertTimeRange(CMTimeRange(start: from, duration: take), of: track, at: at) } catch { NSLog("[GhostRecord] sound insert failed: %@", error.localizedDescription); return nil }
        guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetAppleM4A) else { NSLog("[GhostRecord] no AAC export"); return nil }
        try? FileManager.default.removeItem(at: url)
        export.outputURL = url
        export.outputFileType = .m4a
        let ok = await withCheckedContinuation { finished in export.exportAsynchronously { finished.resume(returning: export.status == .completed) } }
        if !ok { NSLog("[GhostRecord] sound encode failed: %@", export.error?.localizedDescription ?? "unknown") }
        withExtendedLifetime(asset) {}
        return ok ? url : nil
    }

    /// Picture frames copied as they are, plus the laid-out AAC sound, into one MP4.
    private static func mux(video track: AVAssetTrack, span: CMTimeRange, sound: URL, to url: URL) async -> Bool {
        let length = span.duration
        let composition = AVMutableComposition()
        // Kept for the whole join: a track whose asset is gone cannot be inserted.
        let soundAsset = AVURLAsset(url: sound)
        guard let picture = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let lane = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid),
              let audio = try? await soundAsset.loadTracks(withMediaType: .audio).first,
              let heard = try? await audio.load(.timeRange) else { NSLog("[GhostRecord] the encoded sound cannot be read"); return false }
        do {
            try picture.insertTimeRange(span, of: track, at: .zero)
            if let transform = try? await track.load(.preferredTransform) { picture.preferredTransform = transform }
        } catch { NSLog("[GhostRecord] picture insert failed: %@", String(describing: error)); return false }
        do {
            // The sound track's own span (an encoder's priming is outside it); never longer than the picture.
            try lane.insertTimeRange(CMTimeRange(start: heard.start, duration: CMTimeMinimum(heard.duration, length)), of: audio, at: .zero)
        } catch { NSLog("[GhostRecord] sound insert failed: %@", String(describing: error)); return false }
        let ok = await remux(composition, to: url)
        NSLog("[GhostRecord] picture and sound %@", ok ? "joined" : "could not be joined")
        withExtendedLifetime(soundAsset) {}
        return ok
    }

    /// Passthrough export: the frames are copied as they are, only the container is rewritten.
    private static func remux(_ asset: AVAsset, to url: URL) async -> Bool {
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else { return false }
        export.outputURL = url
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        return await withCheckedContinuation { finished in
            export.exportAsynchronously {
                if export.status != .completed { NSLog("[GhostRecord] export: %@", export.error?.localizedDescription ?? "not completed") }
                finished.resume(returning: export.status == .completed)
            }
        }
    }
}

/// The sound of one take: what the visuals heard, written as 48 kHz stereo against the wall clock,
/// with silence wherever nothing arrived (the player paused, the source changed), so that at the end
/// it can be laid exactly against the picture.
final class TakeSound {
    struct Written { let url: URL; var start: Double?; let seconds: Double }
    let url: URL
    private var file: AVAudioFile?
    private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000, channels: 2, interleaved: false)!
    private var converter: AVAudioConverter?
    private let lock = NSLock()
    /// Wall-clock seconds of the first sample, on this device's clock.
    private var start: Double?
    private var nextHost: Double = 0
    private var frames: AVAudioFramePosition = 0

    init(url: URL) throws {
        self.url = url
        try? FileManager.default.removeItem(at: url)
        // 16-bit in the file keeps a five-minute take near 55 MB until it is encoded.
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 2,
                                       AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false]
        file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    }

    static func seconds(host: UInt64) -> Double { AVAudioTime.seconds(forHostTime: host) }
    /// The wall-clock time of a moment given on the host clock.
    static func wall(host seconds: Double) -> Double { Date().timeIntervalSince1970 - (Self.seconds(host: mach_absolute_time()) - seconds) }

    /// Called from the audio tap's thread with each analysed buffer.
    func append(_ buffer: AVAudioPCMBuffer, at when: AVAudioTime) {
        guard buffer.frameLength > 0, buffer.format.sampleRate > 0 else { return }
        let length = Double(buffer.frameLength) / buffer.format.sampleRate
        let begins = when.isHostTimeValid ? Self.seconds(host: when.hostTime) : Self.seconds(host: mach_absolute_time()) - length
        lock.lock(); defer { lock.unlock() }
        guard file != nil else { return }
        if start == nil { start = Self.wall(host: begins); nextHost = begins }
        let gap = begins - nextHost
        if gap > 0.03 { writeSilence(gap) }
        guard let converted = convert(buffer) else { return }
        write(converted)
        nextHost = max(nextHost, begins) + length
    }

    /// Silence until the sound is `total` seconds long.
    func padTo(seconds total: Double) {
        lock.lock(); defer { lock.unlock() }
        let missing = total - Double(frames) / format.sampleRate
        if missing > 0 { writeSilence(missing) }
    }

    /// Finishes the file. Nothing more is written after this.
    func close() -> Written {
        lock.lock(); defer { lock.unlock() }
        file = nil
        return Written(url: url, start: start, seconds: Double(frames) / format.sampleRate)
    }

    private func write(_ buffer: AVAudioPCMBuffer) {
        do { try file?.write(from: buffer); frames += AVAudioFramePosition(buffer.frameLength) } catch { file = nil }
    }

    private func writeSilence(_ seconds: Double) {
        var left = AVAudioFrameCount(max(0, (seconds * format.sampleRate).rounded()))
        while left > 0, file != nil {
            let count = min(left, 4800)
            guard let quiet = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: count), let data = quiet.floatChannelData else { return }
            quiet.frameLength = count
            for c in 0..<Int(format.channelCount) { data[c].update(repeating: 0, count: Int(count)) }
            write(quiet)
            left -= count
        }
    }

    /// Mono becomes both channels; other rates and layouts go through a converter that keeps its state.
    private func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        var input = buffer
        if buffer.format.channelCount == 1, buffer.format.commonFormat == .pcmFormatFloat32, let mono = buffer.floatChannelData,
           let stereoFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: buffer.format.sampleRate, channels: 2, interleaved: false),
           let stereo = AVAudioPCMBuffer(pcmFormat: stereoFormat, frameCapacity: buffer.frameLength), let out = stereo.floatChannelData {
            stereo.frameLength = buffer.frameLength
            out[0].update(from: mono[0], count: Int(buffer.frameLength))
            out[1].update(from: mono[0], count: Int(buffer.frameLength))
            input = stereo
        }
        if input.format.sampleRate == format.sampleRate, input.format.channelCount == format.channelCount,
           input.format.commonFormat == format.commonFormat, !input.format.isInterleaved { return input }
        if converter?.inputFormat != input.format { converter = AVAudioConverter(from: input.format, to: format) }
        guard let converter = converter else { return nil }
        let capacity = AVAudioFrameCount(Double(input.frameLength) * format.sampleRate / input.format.sampleRate) + 64
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
        var given = false
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, state in
            if given { state.pointee = .noDataNow; return nil }
            given = true
            state.pointee = .haveData
            return input
        }
        return status == .error ? nil : output
    }
}
