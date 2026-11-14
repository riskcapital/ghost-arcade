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
///   recordingBegin({ mimeType }) -> { id }
///   recordingAppend({ id, base64 }) -> { bytes }
///   recordingFinish({ id, filename }) -> { id, path, bytes, durationMs, width, height }
///     Closes the file and rewrites it as a plain MP4 that Photos and every share target accept.
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

    @objc func recordingBegin(_ call: CAPPluginCall) {
        let ext = (call.getString("mimeType") ?? "").contains("webm") ? "webm" : "mp4"
        files.async {
            let id = UUID().uuidString
            let folder = Recordings.folder(id)
            let raw = folder.appendingPathComponent("capture.\(ext)")
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                guard FileManager.default.createFile(atPath: raw.path, contents: nil) else { throw Recordings.failure("The recording could not be stored.") }
                self.writing[id] = try FileHandle(forWritingTo: raw)
                call.resolve(["id": id])
            } catch { try? FileManager.default.removeItem(at: folder); call.reject(error.localizedDescription) }
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
            let folder = Recordings.folder(id)
            guard let raw = Recordings.capture(in: folder) else { call.reject("The recording is empty."); return }
            let final = folder.appendingPathComponent(name)
            Recordings.finalize(raw, to: final) { result in
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
        return files.first { !$0.lastPathComponent.hasPrefix("capture.") }
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

    /// Rewrites the captured stream as a plain MP4 (same video, no re-encode) and measures it.
    static func finalize(_ raw: URL, to final: URL, done: @escaping (Result<[String: Any], Error>) -> Void) {
        let asset = AVURLAsset(url: raw)
        Task {
            do {
                let tracks = try await asset.loadTracks(withMediaType: .video)
                guard let track = tracks.first else { throw failure("The recording has no picture.") }
                let size = try await track.load(.naturalSize)
                try? FileManager.default.removeItem(at: final)
                var output = final
                if await remux(asset, to: final) {
                    try? FileManager.default.removeItem(at: raw)
                } else {
                    // The capture itself still plays; hand that over under the right name.
                    try? FileManager.default.removeItem(at: final)
                    output = final.deletingPathExtension().appendingPathExtension(raw.pathExtension)
                    try FileManager.default.moveItem(at: raw, to: output)
                }
                let duration = try await AVURLAsset(url: output).load(.duration)
                let bytes = (try? output.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                done(.success([
                    "path": output.path,
                    "bytes": bytes,
                    "durationMs": duration.isNumeric ? Int((duration.seconds * 1000).rounded()) : 0,
                    "width": Int(abs(size.width)),
                    "height": Int(abs(size.height))
                ]))
            } catch {
                done(.failure(error))
            }
        }
    }

    /// Passthrough export: the frames are copied as they are, only the container is rewritten.
    private static func remux(_ asset: AVAsset, to url: URL) async -> Bool {
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else { return false }
        export.outputURL = url
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        return await withCheckedContinuation { finished in
            export.exportAsynchronously { finished.resume(returning: export.status == .completed) }
        }
    }
}
