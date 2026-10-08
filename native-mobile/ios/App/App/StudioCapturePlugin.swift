import UIKit
import ARKit
import AVFoundation
import UniformTypeIdentifiers
import Capacitor

/// A tapped `ghostarcade://pair?...` link waits here until the web layer takes it.
/// One slot, taken once: the newest link wins and no link is ever delivered twice.
enum PairingLinkInbox {
    /// Posted on the main queue when a link arrives, so the web layer can be told to collect it.
    static let arrived = Notification.Name("GhostPairingLinkArrived")
    private static let lock = NSLock()
    private static var pending: String?
    static func accepts(_ url: URL) -> Bool { url.scheme?.lowercased() == "ghostarcade" && url.host?.lowercased() == "pair" }
    /// Returns true when the URL was a pairing link (and so must not be forwarded anywhere else).
    @discardableResult static func receive(_ url: URL) -> Bool {
        guard accepts(url) else { return false }
        let link = url.absoluteString
        guard link.utf8.count <= 4096 else { return true }
        lock.lock(); pending = link; lock.unlock()
        // The link carries the pairing code, so only the fact that one arrived is logged.
        NSLog("[GhostPair] pairing link received")
        DispatchQueue.main.async { NotificationCenter.default.post(name: arrived, object: nil) }
        return true
    }
    static func take() -> String? { lock.lock(); defer { lock.unlock() }; let link = pending; pending = nil; return link }
}

@objc(StudioCapturePlugin)
public final class StudioCapturePlugin: CAPPlugin, CAPBridgedPlugin {
    @objc func takePairingLink(_ call: CAPPluginCall) {
        let link = PairingLinkInbox.take()
        if link != nil { NSLog("[GhostPair] pairing link handed to the app") }
        call.resolve(["url": link ?? ""])
    }
    public let identifier="StudioCapturePlugin"
    public let jsName="StudioCapture"
    public let pluginMethods:[CAPPluginMethod]=[
        CAPPluginMethod(name:"scanPairingCode",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"takePairingLink",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"liveConfigure",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"calibrationReference",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"shareCalibrationPreparation",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"shareInteractiveScene",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"capabilities",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"openScanner",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"openDualCamera",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"listScans",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"shareScan",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"deleteScan",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"shareFile",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"haptic",returnType:CAPPluginReturnPromise)
    ]
    @objc func shareInteractiveScene(_ call: CAPPluginCall) { sharePreparation(call, schema: "ghost-interactive", prefix: "Interactive") }
    @objc func shareCalibrationPreparation(_ call: CAPPluginCall) { sharePreparation(call, schema: "ghost-calibration", prefix: "Calibration") }
    private func sharePreparation(_ call: CAPPluginCall, schema: String, prefix: String) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8), data.count < 25_000_000,
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              object["schema"] as? String == schema, object["version"] as? Int == 1 else {
            call.reject("Invalid or oversized preparation package."); return
        }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(prefix + "-" + UUID().uuidString + (schema == "ghost-calibration" ? ".ghostcal.json" : ".ghostinteractive.json"))
        do { try data.write(to: file, options: .atomic) } catch { call.reject(error.localizedDescription); return }
        share(file, anchor: nil) { outcome in
            try? FileManager.default.removeItem(at: file)
            switch outcome {
            case .completed: call.resolve()
            case .cancelled: call.reject("Export cancelled. Your preparation is still here.")
            case .unavailable(let reason), .failed(let reason): call.reject(reason)
            }
        }
    }
    @objc func calibrationReference(_ call: CAPPluginCall) {
        StudioLiveCapture.shared.calibrationReference { reference, error in
            if let reference = reference { call.resolve(reference) } else { call.reject(error ?? "Reference unavailable.") }
        }
    }
    @objc func liveConfigure(_ call: CAPPluginCall) {
        let sources = call.getArray("sources", String.self) ?? []
        let configure = { StudioLiveCapture.shared.configure(sources) { error in if let error = error { call.reject(error.localizedDescription) } else { call.resolve() } } }
        if sources.isEmpty { configure() } else { permission(call, presents: false, then: configure) }
    }
    @objc func capabilities(_ call:CAPPluginCall){call.resolve(["lidar":ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth),"dualCamera":AVCaptureMultiCamSession.isMultiCamSupported,"platform":"ios"])}
    @objc func listScans(_ call:CAPPluginCall){DispatchQueue.global(qos:.userInitiated).async{do{call.resolve(["scans":try ScanFiles.list()])}catch{call.reject(error.localizedDescription)}}}
    @objc func deleteScan(_ call:CAPPluginCall){guard let id=call.getString("id"),UUID(uuidString:id) != nil else{call.reject("Invalid scan.");return};DispatchQueue.global(qos:.userInitiated).async{do{try FileManager.default.removeItem(at:ScanFiles.root().appendingPathComponent(id));call.resolve()}catch{call.reject(error.localizedDescription)}}}
    @objc func shareScan(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), UUID(uuidString: id) != nil else { call.reject("Invalid scan."); return }
        guard let file = try? ScanFiles.root().appendingPathComponent(id).appendingPathComponent("scan.ply"),
              FileManager.default.fileExists(atPath: file.path) else { call.reject("Scan file not found."); return }
        share(file, anchor: nil) { outcome in
            switch outcome {
            case .completed: call.resolve(["shared": true])
            case .cancelled: call.resolve(["shared": false])
            case .unavailable(let reason), .failed(let reason): call.reject(reason)
            }
        }
    }
    // MARK: Share sheet

    enum ShareOutcome { case completed, cancelled, unavailable(String), failed(String) }

    /// Shows the system share sheet for one file and reports exactly one outcome, whatever happens to the sheet.
    /// `anchor` is the control that opened it, in web view points; iPad points the popover at it.
    private func share(_ file: URL, anchor: CGRect?, done: @escaping (ShareOutcome) -> Void) {
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController, host.viewIfLoaded?.window != nil else { done(.unavailable("Sharing is not available right now.")); return }
            guard host.presentedViewController == nil else { done(.unavailable("Close the other native tool before sharing.")); return }
            let once = ShareOnce(done)
            let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            // Saving to Photos needs a permission this app does not ask for. Files, AirDrop and the rest stay.
            sheet.excludedActivityTypes = [.saveToCameraRoll]
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
            sheet.completionWithItemsHandler = { _, completed, _, error in
                if let error = error { once.report(.failed(error.localizedDescription)) } else { once.report(completed ? .completed : .cancelled) }
            }
            host.present(sheet, animated: true)
        }
    }
    /// shareFile({ filename, base64, mimeType, anchor?: { x, y, width, height } }) -> { completed }
    /// Writes the bytes to a temporary file with that name, shows the share sheet, then removes the file.
    @objc func shareFile(_ call: CAPPluginCall) {
        guard let name = Self.safeFilename(call.getString("filename"), mimeType: call.getString("mimeType")) else { call.reject("A file name is needed to share."); return }
        guard var text = call.getString("base64"), !text.isEmpty else { call.reject("There is nothing to share."); return }
        if text.hasPrefix("data:"), let comma = text.firstIndex(of: ",") { text = String(text[text.index(after: comma)...]) }
        guard text.utf8.count / 4 * 3 <= 250_000_000 else { call.reject("This file is too large to share."); return }
        guard let data = Data(base64Encoded: text, options: .ignoreUnknownCharacters), !data.isEmpty else { call.reject("The file could not be read."); return }
        // Its own folder, so the shared file keeps exactly the name the user will see.
        let folder = SharedFiles.root().appendingPathComponent(UUID().uuidString, isDirectory: true)
        let file = folder.appendingPathComponent(name)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try data.write(to: file, options: .atomic)
        } catch { try? FileManager.default.removeItem(at: folder); call.reject(error.localizedDescription); return }
        var anchor: CGRect?
        if let box = call.getObject("anchor") {
            let value = { (key: String) in (box[key] as? NSNumber)?.doubleValue }
            if let x = value("x"), let y = value("y"), let width = value("width"), let height = value("height"),
               [x, y, width, height].allSatisfy({ $0.isFinite }) { anchor = CGRect(x: x, y: y, width: width, height: height) }
        }
        share(file, anchor: anchor) { outcome in
            try? FileManager.default.removeItem(at: folder)
            switch outcome {
            case .completed: call.resolve(["completed": true])
            case .cancelled: call.resolve(["completed": false])
            case .unavailable(let reason), .failed(let reason): call.reject(reason)
            }
        }
    }
    /// Only the last path component is kept, so a name can never point outside the temporary folder.
    static func safeFilename(_ raw: String?, mimeType: String?) -> String? {
        var name = ((raw ?? "") as NSString).lastPathComponent
        name = name.components(separatedBy: CharacterSet.controlCharacters.union(CharacterSet(charactersIn: "/\\:"))).joined()
        name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != ".", name != ".." else { return nil }
        if name.hasPrefix(".") { name = "File" + name }
        if (name as NSString).pathExtension.isEmpty, let mimeType = mimeType, let ext = UTType(mimeType: mimeType)?.preferredFilenameExtension { name += "." + ext }
        let ext = (name as NSString).pathExtension
        var base = (name as NSString).deletingPathExtension
        while (base + "." + ext).utf8.count > 200, base.count > 1 { base.removeLast() }
        return ext.isEmpty ? base : base + "." + ext
    }

    // MARK: Haptics

    // Main thread only. Kept alive so a tap does not pay the generator start-up cost every time.
    private lazy var impacts: [String: UIImpactFeedbackGenerator] = ["light": UIImpactFeedbackGenerator(style: .light), "medium": UIImpactFeedbackGenerator(style: .medium), "heavy": UIImpactFeedbackGenerator(style: .heavy)]
    private lazy var selection = UISelectionFeedbackGenerator()
    private lazy var notice = UINotificationFeedbackGenerator()
    /// haptic({ type: 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error' }) -> {}
    @objc func haptic(_ call: CAPPluginCall) {
        let type = call.getString("type") ?? ""
        DispatchQueue.main.async {
            switch type {
            case "light", "medium", "heavy": self.impacts[type]?.impactOccurred(); self.impacts[type]?.prepare()
            case "selection": self.selection.selectionChanged(); self.selection.prepare()
            case "success": self.notice.notificationOccurred(.success)
            case "warning": self.notice.notificationOccurred(.warning)
            case "error": self.notice.notificationOccurred(.error)
            default: call.reject("Unknown haptic type."); return
            }
            call.resolve([:])
        }
    }

    // MARK: Camera permission

    /// Every path ends in `then()` or a rejection. `presents` is false for calls that show no native screen.
    private func permission(_ call: CAPPluginCall, presents: Bool = true, then: @escaping () -> Void) {
        let run = {
            DispatchQueue.main.async {
                if presents {
                    guard let host = self.bridge?.viewController, host.viewIfLoaded?.window != nil, host.presentedViewController == nil else { call.reject("Close the current native tool first."); return }
                }
                then()
            }
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: run()
        case .notDetermined: AVCaptureDevice.requestAccess(for: .video) { granted in if granted { run() } else { call.reject("Camera access was denied. Enable it in iOS Settings.") } }
        default: call.reject("Camera access is disabled in iOS Settings.")
        }
    }
    @objc func openScanner(_ call:CAPPluginCall){
        guard ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) else{call.reject("LiDAR scanning requires a LiDAR-equipped iPhone Pro or iPad Pro.");return}
        permission(call){let tool=ScanViewController();tool.liveMode=call.getString("mode")=="live";tool.onDone={call.resolve()};self.present(tool)}
    }
    @objc func scanPairingCode(_ call:CAPPluginCall){permission(call){let tool=PairingScannerViewController();tool.onDone={url in call.resolve(["url":url ?? "", "cancelled":url == nil])};self.present(tool)}}
    @objc func openDualCamera(_ call:CAPPluginCall){guard AVCaptureMultiCamSession.isMultiCamSupported else{call.reject("Simultaneous front/rear capture is not supported on this device.");return};permission(call){let tool=DualCameraViewController();tool.onDone={shots in call.resolve(["shots":shots])};self.present(tool)}}
    private func present(_ controller:UIViewController){let nav=UINavigationController(rootViewController:controller);nav.modalPresentationStyle = .fullScreen;nav.overrideUserInterfaceStyle = .dark;let appearance=UINavigationBarAppearance();appearance.configureWithOpaqueBackground();appearance.backgroundColor=UIColor(red:0.035,green:0.045,blue:0.06,alpha:1);appearance.titleTextAttributes=[.foregroundColor:UIColor.white];nav.navigationBar.standardAppearance=appearance;nav.navigationBar.scrollEdgeAppearance=appearance;nav.navigationBar.tintColor=UIColor(red:0.55,green:0.7,blue:1,alpha:1);bridge?.viewController?.present(nav,animated:true)}
}

/// Reports a share outcome exactly once. If the sheet goes away without calling back
/// (dismissed in code, or never shown), the call still ends as cancelled instead of hanging.
private final class ShareOnce {
    private var done: ((StudioCapturePlugin.ShareOutcome) -> Void)?
    init(_ done: @escaping (StudioCapturePlugin.ShareOutcome) -> Void) { self.done = done }
    func report(_ outcome: StudioCapturePlugin.ShareOutcome) { let done = self.done; self.done = nil; done?(outcome) }
    deinit { done?(.cancelled) }
}

/// Temporary copies handed to the share sheet.
enum SharedFiles {
    static func root() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("GhostShare", isDirectory: true) }
    /// Nothing can be mid-share at launch, so anything still here is from a run that ended early.
    static func purge() { try? FileManager.default.removeItem(at: root()) }
}

enum ScanFiles {
    static func root() throws -> URL {
        guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { throw NSError(domain: "GhostScans", code: 1, userInfo: [NSLocalizedDescriptionKey: "App storage is unavailable."]) }
        let root = documents.appendingPathComponent("GhostScans", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }
    static func save(points:[ScanPoint],name:String,mode:String,thumbnail:Data?,chunks:[URL]=[],archivedCount:Int=0)throws->[String:Any]{
        let id=UUID().uuidString,folder=try root().appendingPathComponent(id,isDirectory:true);try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        do{let bytes=try writeScanPLY(points:points,chunks:chunks,archivedCount:archivedCount,to:folder.appendingPathComponent("scan.ply"));if let thumbnail=thumbnail{try thumbnail.write(to:folder.appendingPathComponent("preview.jpg"),options:.atomic)}
            let meta:[String:Any]=["id":id,"name":name,"points":points.count+archivedCount,"bytes":bytes,"created":ISO8601DateFormatter().string(from:Date()),"mode":mode]
            try JSONSerialization.data(withJSONObject:meta).write(to:folder.appendingPathComponent("metadata.json"),options:.atomic)
            return meta
        }catch{try? FileManager.default.removeItem(at:folder);throw error}
    }
    static func list()throws->[[String:Any]]{try FileManager.default.contentsOfDirectory(at:root(),includingPropertiesForKeys:nil).compactMap{folder in guard UUID(uuidString:folder.lastPathComponent) != nil,let data=try? Data(contentsOf:folder.appendingPathComponent("metadata.json")),var meta=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any] else{return nil};meta["url"]=folder.appendingPathComponent("scan.ply").absoluteString;meta["thumbnail"]=folder.appendingPathComponent("preview.jpg").absoluteString;return meta}.sorted{($0["created"] as? String ?? "")>($1["created"] as? String ?? "")}}
}


private final class PairingScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onDone: ((String?) -> Void)?
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "live.ghostarcade.pairing-scanner")
    private lazy var preview = AVCaptureVideoPreviewLayer(session: session)
    private let hint = UILabel()
    private var finished = false
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Desktop Connect"
        view.backgroundColor = .black
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel, target: self, action: #selector(cancel))
        preview.videoGravity = .resizeAspectFill
        view.layer.addSublayer(preview)
        hint.text = "Point at the QR in desktop Connect Mobile"
        hint.textColor = .white
        hint.backgroundColor = UIColor.black.withAlphaComponent(0.75)
        hint.textAlignment = .center
        hint.numberOfLines = 0
        hint.layer.cornerRadius = 12
        hint.clipsToBounds = true
        view.addSubview(hint)
        NotificationCenter.default.addObserver(self, selector: #selector(paused), name: AVCaptureSession.wasInterruptedNotification, object: session)
        NotificationCenter.default.addObserver(self, selector: #selector(resumed), name: AVCaptureSession.interruptionEndedNotification, object: session)
        NotificationCenter.default.addObserver(self, selector: #selector(failed), name: AVCaptureSession.runtimeErrorNotification, object: session)
        queue.async { [self] in
            session.beginConfiguration()
            if session.isMultitaskingCameraAccessSupported { session.isMultitaskingCameraAccessEnabled = true }
            guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                  let input = try? AVCaptureDeviceInput(device: camera), session.canAddInput(input) else {
                session.commitConfiguration(); showError(); return
            }
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { session.commitConfiguration(); showError(); return }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
            session.commitConfiguration()
            session.startRunning()
        }
    }
    private func showError() { DispatchQueue.main.async { self.hint.text = "Camera unavailable. Cancel and try again, or paste the pairing link." } }
    // Capture notifications arrive on any thread. The session resumes by itself after an interruption.
    @objc private func paused() { DispatchQueue.main.async { self.hint.text = "Camera paused. It comes back when it is free." } }
    @objc private func resumed() {
        DispatchQueue.main.async {
            guard !self.finished else { return } // never restart the camera after the scanner has closed
            self.hint.text = "Point at the QR in desktop Connect Mobile"
            self.queue.async { if !self.session.isRunning { self.session.startRunning() } }
        }
    }
    @objc private func failed() { showError() }
    deinit { NotificationCenter.default.removeObserver(self) }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview.frame = view.bounds
        hint.frame = CGRect(x: 24, y: view.safeAreaInsets.top + 24, width: view.bounds.width - 48, height: 64)
        if let connection = preview.connection, connection.isVideoOrientationSupported {
            switch view.window?.windowScene?.interfaceOrientation {
            case .landscapeLeft: connection.videoOrientation = .landscapeLeft
            case .landscapeRight: connection.videoOrientation = .landscapeRight
            case .portraitUpsideDown: connection.videoOrientation = .portraitUpsideDown
            default: connection.videoOrientation = .portrait
            }
        }
    }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        queue.async { self.session.stopRunning() }
    }
    @objc private func cancel() { finish(nil) }
    private func finish(_ value: String?) {
        guard !finished else { return }; finished = true
        queue.async { self.session.stopRunning() }
        dismiss(animated: true) { self.onDone?(value) }
    }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !finished, let raw = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue,
              let url = URLComponents(string: raw) else { return }
        let scheme = url.scheme?.lowercased() ?? ""
        let isWeb = ["http", "https"].contains(scheme) && url.queryItems?.contains(where: { $0.name == "pair" && !($0.value ?? "").isEmpty }) == true
        let isApp = scheme == "ghostarcade" && url.host == "pair"
        guard isWeb || isApp else { hint.text = "Use a Ghost Arcade desktop pairing QR."; return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        finish(raw)
    }
}
