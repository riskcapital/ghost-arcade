import UIKit
import ARKit
import AVFoundation
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
        CAPPluginMethod(name:"deleteScan",returnType:CAPPluginReturnPromise)
    ]
    @objc func shareInteractiveScene(_ call: CAPPluginCall) { sharePreparation(call, schema: "ghost-interactive", prefix: "Interactive") }
    @objc func shareCalibrationPreparation(_ call: CAPPluginCall) { sharePreparation(call, schema: "ghost-calibration", prefix: "Calibration") }
    private func sharePreparation(_ call: CAPPluginCall, schema: String, prefix: String) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8), data.count < 25_000_000,
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              object["schema"] as? String == schema, object["version"] as? Int == 1 else {
            call.reject("Invalid or oversized preparation package."); return
        }
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController, host.presentedViewController == nil else {
                call.reject("Close the other native tool before sharing."); return
            }
            let file = FileManager.default.temporaryDirectory.appendingPathComponent(prefix + "-" + UUID().uuidString + (schema == "ghost-calibration" ? ".ghostcal.json" : ".ghostinteractive.json"))
            do {
                try data.write(to: file, options: .atomic)
                let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = host.view
                sheet.popoverPresentationController?.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 1, height: 1)
                sheet.completionWithItemsHandler = { _, completed, _, error in
                    try? FileManager.default.removeItem(at: file)
                    if let error = error { call.reject(error.localizedDescription) }
                    else if completed { call.resolve() }
                    else { call.reject("Export cancelled. Your preparation is still here.") }
                }
                host.present(sheet, animated: true)
            } catch { call.reject(error.localizedDescription) }
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
        if sources.isEmpty { configure() } else { permission(call, then: configure) }
    }
    @objc func capabilities(_ call:CAPPluginCall){call.resolve(["lidar":ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth),"dualCamera":AVCaptureMultiCamSession.isMultiCamSupported,"platform":"ios"])}
    @objc func listScans(_ call:CAPPluginCall){DispatchQueue.global(qos:.userInitiated).async{do{call.resolve(["scans":try ScanFiles.list()])}catch{call.reject(error.localizedDescription)}}}
    @objc func deleteScan(_ call:CAPPluginCall){guard let id=call.getString("id"),UUID(uuidString:id) != nil else{call.reject("Invalid scan.");return};DispatchQueue.global(qos:.userInitiated).async{do{try FileManager.default.removeItem(at:ScanFiles.root().appendingPathComponent(id));call.resolve()}catch{call.reject(error.localizedDescription)}}}
    @objc func shareScan(_ call:CAPPluginCall){guard let id=call.getString("id"),UUID(uuidString:id) != nil else{call.reject("Invalid scan.");return};DispatchQueue.main.async{do{let file=try ScanFiles.root().appendingPathComponent(id).appendingPathComponent("scan.ply");guard FileManager.default.fileExists(atPath:file.path),let host=self.bridge?.viewController else{call.reject("Scan file not found.");return};let sheet=UIActivityViewController(activityItems:[file],applicationActivities:nil);sheet.popoverPresentationController?.sourceView=host.view;sheet.popoverPresentationController?.sourceRect=CGRect(x:host.view.bounds.midX,y:host.view.bounds.midY,width:1,height:1);sheet.completionWithItemsHandler={_,completed,_,error in if let error=error{call.reject(error.localizedDescription)}else{call.resolve(["shared":completed])}};host.present(sheet,animated:true)}catch{call.reject(error.localizedDescription)}}}
    private func permission(_ call:CAPPluginCall,then:@escaping ()->Void){
        let run={DispatchQueue.main.async{guard let host=self.bridge?.viewController,host.presentedViewController==nil else{call.reject("Close the current native tool first.");return};then()}}
        switch AVCaptureDevice.authorizationStatus(for:.video){case .authorized:run();case .notDetermined:AVCaptureDevice.requestAccess(for:.video){granted in if granted{run()}else{call.reject("Camera access was denied. Enable it in iOS Settings.")}};default:call.reject("Camera access is disabled in iOS Settings.")}
    }
    @objc func openScanner(_ call:CAPPluginCall){
        guard ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) else{call.reject("LiDAR scanning requires a LiDAR-equipped iPhone Pro or iPad Pro.");return}
        permission(call){let tool=ScanViewController();tool.liveMode=call.getString("mode")=="live";tool.onDone={call.resolve()};self.present(tool)}
    }
    @objc func scanPairingCode(_ call:CAPPluginCall){permission(call){let tool=PairingScannerViewController();tool.onDone={url in call.resolve(["url":url ?? "", "cancelled":url == nil])};self.present(tool)}}
    @objc func openDualCamera(_ call:CAPPluginCall){guard AVCaptureMultiCamSession.isMultiCamSupported else{call.reject("Simultaneous front/rear capture is not supported on this device.");return};permission(call){let tool=DualCameraViewController();tool.onDone={shots in call.resolve(["shots":shots])};self.present(tool)}}
    private func present(_ controller:UIViewController){let nav=UINavigationController(rootViewController:controller);nav.modalPresentationStyle = .fullScreen;nav.overrideUserInterfaceStyle = .dark;let appearance=UINavigationBarAppearance();appearance.configureWithOpaqueBackground();appearance.backgroundColor=UIColor(red:0.035,green:0.045,blue:0.06,alpha:1);appearance.titleTextAttributes=[.foregroundColor:UIColor.white];nav.navigationBar.standardAppearance=appearance;nav.navigationBar.scrollEdgeAppearance=appearance;nav.navigationBar.tintColor=UIColor(red:0.55,green:0.7,blue:1,alpha:1);bridge?.viewController?.present(nav,animated:true)}
}

enum ScanFiles {
    static func root()throws->URL{let root=FileManager.default.urls(for:.documentDirectory,in:.userDomainMask)[0].appendingPathComponent("GhostScans",isDirectory:true);try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true);return root}
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
    private var preview: AVCaptureVideoPreviewLayer!
    private let hint = UILabel()
    private var finished = false
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Desktop Connect"
        view.backgroundColor = .black
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel, target: self, action: #selector(cancel))
        preview = AVCaptureVideoPreviewLayer(session: session)
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
        queue.async { [self] in
            session.beginConfiguration()
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
