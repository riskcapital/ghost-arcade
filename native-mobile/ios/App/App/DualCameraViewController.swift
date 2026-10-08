import UIKit
import AVFoundation
import CoreImage

/// Dual-camera stills are a hand-off: the web layer copies each one into its own library right after the session.
/// They live in Caches, never in Documents (which shows in Files and is backed up), one folder per session,
/// and a folder is removed as soon as no session is using it.
enum DualCameraStills {
    private static let lock = NSLock()
    private static var inUse = Set<String>()
    private static let files = DispatchQueue(label: "live.ghostarcade.dualcamera.files", qos: .utility)
    private static func root() -> URL? { FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("GhostCamera", isDirectory: true) }

    /// Starts a session: reserves its name, then clears out whatever no session is using.
    static func begin() -> String {
        let session = UUID().uuidString
        lock.lock(); inUse.insert(session); lock.unlock()
        purge()
        return session
    }
    static func folder(_ session: String) throws -> URL {
        guard let root = root() else { throw NSError(domain: "GhostCapture", code: 2, userInfo: [NSLocalizedDescriptionKey: "App storage is unavailable."]) }
        let folder = root.appendingPathComponent(session, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }
    /// Ends a session. Stills handed to the web layer stay long enough to be copied, then go.
    static func end(_ session: String, handedOff: Bool) {
        let release = { lock.lock(); inUse.remove(session); lock.unlock(); purge() }
        if handedOff { DispatchQueue.main.asyncAfter(deadline: .now() + 120, execute: release) } else { release() }
    }
    /// Removes every still that no open or just-finished session is using. Also removes Documents/GhostCamera,
    /// which earlier versions filled and never emptied; those images were already copied into the clip library.
    static func purge() {
        files.async {
            let manager = FileManager.default
            if let legacy = manager.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent("GhostCamera", isDirectory: true) { try? manager.removeItem(at: legacy) }
            guard let root = root(), let entries = try? manager.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return }
            // Read the sessions in use after listing: a folder can only exist once its session is reserved.
            lock.lock(); let keep = inUse; lock.unlock()
            for entry in entries where !keep.contains(entry.lastPathComponent) { try? manager.removeItem(at: entry) }
        }
    }
}

final class DualCameraViewController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate {
    var onDone: (([[String: String]]) -> Void)?
    private let stills = DualCameraStills.begin()
    private let session = AVCaptureMultiCamSession()
    private let queue = DispatchQueue(label: "live.ghostarcade.dualcamera", qos: .userInitiated)
    private let backView = UIView(), frontView = UIView(), stage = UIView()
    private let status = UILabel(), pauseButton = UIButton(type: .system), captureButton = UIButton(type: .system)
    private let layout = UISegmentedControl(items: ["Split", "Picture in picture"])
    private var previews: [AVCaptureVideoPreviewLayer] = []
    private var outputs: [AVCaptureVideoDataOutput] = []
    private var frames: [Int: CVPixelBuffer] = [:] // only the latest frame per camera; queue-owned
    private var shots: [[String: String]] = []
    private var closed = false, paused = false, swapped = false, configured = false
    private var capturing = false
    private var orientation: AVCaptureVideoOrientation = .portrait

    override func viewDidLoad() {
        super.viewDidLoad(); title = "Dual Camera"
        view.backgroundColor = UIColor(red: 0.035, green: 0.04, blue: 0.055, alpha: 1)
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Done", style: .done, target: self, action: #selector(close))
        for child in [backView, frontView] { child.backgroundColor = .black; child.clipsToBounds = true; stage.addSubview(child) }
        stage.backgroundColor = .black
        status.text = "Starting front + rear cameras…"; status.font = .systemFont(ofSize: 12, weight: .medium); status.textColor = .lightGray; status.numberOfLines = 2; status.textAlignment = .center
        layout.selectedSegmentIndex = 0; layout.addTarget(self, action: #selector(relayout), for: .valueChanged)
        let swap = UIButton(type: .system); swap.setTitle("Swap views", for: .normal); swap.addTarget(self, action: #selector(swapViews), for: .touchUpInside)
        pauseButton.setTitle("Pause", for: .normal); pauseButton.addTarget(self, action: #selector(togglePause), for: .touchUpInside)
        captureButton.setTitle("Capture pair", for: .normal); captureButton.addTarget(self, action: #selector(capturePair), for: .touchUpInside); captureButton.isEnabled = false
        let buttons = UIStackView(arrangedSubviews: [swap, pauseButton, captureButton]); buttons.distribution = .fillEqually
        let hint = UILabel(); hint.text = "Both cameras live • Selfie mirrored • Capture pair adds two still clips to your library"
        hint.font = .systemFont(ofSize: 11); hint.textColor = .gray; hint.numberOfLines = 2; hint.textAlignment = .center
        let controls = UIStackView(arrangedSubviews: [status, layout, buttons, hint]); controls.axis = .vertical; controls.spacing = 12
        for v in [stage, controls] { v.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(v) }
        NSLayoutConstraint.activate([stage.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), stage.leadingAnchor.constraint(equalTo: view.leadingAnchor), stage.trailingAnchor.constraint(equalTo: view.trailingAnchor), stage.bottomAnchor.constraint(equalTo: controls.topAnchor, constant: -12), controls.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16), controls.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16), controls.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12), buttons.heightAnchor.constraint(equalToConstant: 44)])
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted), name: AVCaptureSession.wasInterruptedNotification, object: session)
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted), name: AVCaptureSession.runtimeErrorNotification, object: session)
        queue.async { self.configure() }
    }
    private func configure() {
        session.beginConfiguration()
        // Keeps both cameras running in Split View and Stage Manager on iPads that allow it.
        if session.isMultitaskingCameraAccessSupported { session.isMultitaskingCameraAccessEnabled = true }
        do {
            for position: AVCaptureDevice.Position in [.back, .front] {
                guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position) else { throw failure("Camera unavailable.") }
                // A 720p, 24fps pair keeps capture sustainable on supported older iPhones.
                let candidates = device.formats.filter { f in let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription); return f.isMultiCamSupported && d.width >= 640 && d.width <= 1280 && d.height <= 720 && f.videoSupportedFrameRateRanges.contains { $0.minFrameRate <= 24 && $0.maxFrameRate >= 24 } }
                guard let format = candidates.max(by: { CMVideoFormatDescriptionGetDimensions($0.formatDescription).width < CMVideoFormatDescriptionGetDimensions($1.formatDescription).width }) else { throw failure("A compatible dual-camera format is unavailable.") }
                try device.lockForConfiguration(); device.activeFormat = format; device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 24); device.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 24); device.unlockForConfiguration()
                let input = try AVCaptureDeviceInput(device: device)
                guard session.canAddInput(input) else { throw failure("Cannot connect both cameras.") }; session.addInputWithNoConnections(input)
                guard let port = input.ports(for: .video, sourceDeviceType: .builtInWideAngleCamera, sourceDevicePosition: position).first else { throw failure("Camera video port unavailable.") }
                let preview = AVCaptureVideoPreviewLayer(); preview.setSessionWithNoConnection(session); preview.videoGravity = .resizeAspect
                let connection = AVCaptureConnection(inputPort: port, videoPreviewLayer: preview)
                guard session.canAddConnection(connection) else { throw failure("Cannot preview both cameras.") }; session.addConnection(connection)
                configureConnection(connection, front: position == .front)
                let output = AVCaptureVideoDataOutput(); output.alwaysDiscardsLateVideoFrames = true
                output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
                output.setSampleBufferDelegate(self, queue: queue)
                guard session.canAddOutput(output) else { throw failure("Cannot capture both cameras.") }; session.addOutputWithNoConnections(output)
                let dataConnection = AVCaptureConnection(inputPorts: [port], output: output)
                guard session.canAddConnection(dataConnection) else { throw failure("Cannot connect camera capture.") }; session.addConnection(dataConnection); configureConnection(dataConnection, front: position == .front)
                outputs.append(output)
                DispatchQueue.main.async { guard !self.closed else { return }; self.previews.append(preview); (position == .back ? self.backView : self.frontView).layer.addSublayer(preview); self.relayout() }
            }
            session.commitConfiguration()
            guard session.hardwareCost <= 1 else { throw failure("This camera combination exceeds the device’s capture capacity.") }
            session.startRunning()
            DispatchQueue.main.async { guard !self.closed else { return }; self.configured = true; self.status.text = "Front + rear · 24 fps"; self.captureButton.isEnabled = true; self.updateOrientation() }
        } catch {
            if outputs.count < 2 { session.commitConfiguration() }
            session.stopRunning()
            DispatchQueue.main.async { self.status.text = error.localizedDescription; self.pauseButton.isEnabled = false; self.captureButton.isEnabled = false }
        }
    }
    private func failure(_ message: String) -> NSError { NSError(domain: "GhostCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    private func configureConnection(_ c: AVCaptureConnection, front: Bool) {
        if c.isVideoOrientationSupported { c.videoOrientation = orientation }
        if c.isVideoMirroringSupported { c.automaticallyAdjustsVideoMirroring = false; c.isVideoMirrored = front }
    }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); relayout(); updateOrientation() }
    private func updateOrientation() {
        let ui = view.window?.windowScene?.interfaceOrientation ?? .portrait
        let next: AVCaptureVideoOrientation
        switch ui { case .landscapeLeft: next = .landscapeLeft; case .landscapeRight: next = .landscapeRight; case .portraitUpsideDown: next = .portraitUpsideDown; default: next = .portrait }
        queue.async { if self.orientation != next { self.orientation = next; for c in self.session.connections where c.isVideoOrientationSupported { c.videoOrientation = next }; self.frames.removeAll() } }
    }
    @objc private func relayout() {
        let first = swapped ? frontView : backView, second = swapped ? backView : frontView, b = stage.bounds
        if layout.selectedSegmentIndex == 0 {
            if b.width > b.height { first.frame = CGRect(x: 0, y: 0, width: b.width / 2 - 2, height: b.height); second.frame = CGRect(x: b.width / 2 + 2, y: 0, width: b.width / 2 - 2, height: b.height) }
            else { first.frame = CGRect(x: 0, y: 0, width: b.width, height: b.height / 2 - 2); second.frame = CGRect(x: 0, y: b.height / 2 + 2, width: b.width, height: b.height / 2 - 2) }
            second.layer.borderWidth = 0
        } else { first.frame = b; second.frame = CGRect(x: b.width * 0.62 - 12, y: 12, width: b.width * 0.38, height: b.height * 0.38); stage.bringSubviewToFront(second); second.layer.borderWidth = 1; second.layer.borderColor = UIColor.lightGray.cgColor }
        for parent in [backView, frontView] { for layer in parent.layer.sublayers ?? [] { if layer is AVCaptureVideoPreviewLayer { layer.frame = parent.bounds } } }
    }
    @objc private func swapViews() { swapped.toggle(); backView.layer.borderWidth = 0; frontView.layer.borderWidth = 0; relayout() }
    @objc private func background() { if !paused { setPaused(true) } }
    @objc private func interrupted() { DispatchQueue.main.async { self.setPaused(true); self.status.text = "Camera interrupted. Resume when ready." } }
    @objc private func togglePause() { setPaused(!paused) }
    private func setPaused(_ value: Bool) {
        paused = value; pauseButton.setTitle(value ? "Resume" : "Pause", for: .normal); captureButton.isEnabled = !value && configured
        queue.async { if value { self.session.stopRunning(); self.frames.removeAll() } else { self.session.startRunning() } }
    }
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let index = outputs.firstIndex(where: { $0 === output }), let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }; frames[index] = buffer
    }
    @objc private func capturePair() {
        guard !capturing, !paused else { return }; capturing = true; captureButton.isEnabled = false; navigationItem.rightBarButtonItem?.isEnabled = false
        queue.async {
            do {
                guard let rear = self.frames[0], let front = self.frames[1] else { throw self.failure("Waiting for both cameras. Try again in a moment.") }
                let context = CIContext(options: [.cacheIntermediates: false]); var pair: [[String: String]] = []
                for (name, buffer) in [("Rear", rear), ("Selfie", front)] {
                    let image = CIImage(cvPixelBuffer: buffer)
                    guard let cg = context.createCGImage(image, from: image.extent), let data = UIImage(cgImage: cg).jpegData(compressionQuality: 0.9) else { throw self.failure("Could not capture the camera frame.") }
                    let file = try DualCameraStills.folder(self.stills).appendingPathComponent(UUID().uuidString + ".jpg"); try data.write(to: file, options: .atomic)
                    pair.append(["name": "\(name) camera", "url": file.absoluteString])
                }
                DispatchQueue.main.async { self.shots.append(contentsOf: pair); self.status.text = "Pair captured. Done adds both images to your clip library."; self.finishCapture() }
            } catch { DispatchQueue.main.async { self.status.text = error.localizedDescription; self.finishCapture() } }
        }
    }
    private func finishCapture() { capturing = false; captureButton.isEnabled = !paused; navigationItem.rightBarButtonItem?.isEnabled = true }
    @objc private func close() { guard !closed, !capturing else { return }; closed = true; queue.async { self.session.stopRunning(); self.outputs.forEach { $0.setSampleBufferDelegate(nil, queue: nil) }; self.frames.removeAll(); DispatchQueue.main.async { self.dismiss(animated: true) { self.onDone?(self.shots); DualCameraStills.end(self.stills, handedOff: !self.shots.isEmpty) } } } }
    deinit { NotificationCenter.default.removeObserver(self) }
}
