import UIKit
import ARKit
import SceneKit

/// Capture is intentionally isolated from the web renderer. Only saved files cross the bridge.
final class ScanViewController: UIViewController, ARSessionDelegate {
    var liveMode = false
    var onDone: (() -> Void)?
    private let sceneView = SCNView()
    private let session = ARSession()
    private let queue = DispatchQueue(label: "live.ghostarcade.scan", qos: .userInitiated)
    private let cloud = SCNNode()
    private let camera = SCNNode()
    private let status = UILabel()
    private let freeze = UIButton(type: .system)
    private let save = UIButton(type: .system)
    private let effects = UISegmentedControl(items: ["Color", "Depth", "Neon", "Dissolve"])
    private let amount = UISlider()
    private let quality = UISegmentedControl(items: ["Fast", "Detail", "Fine"])
    private var samplingStep = 1
    private var frameInterval: TimeInterval = 0.15
    private let range = UISegmentedControl(items: ["Object · 3 m", "Room · 6 m"])
    private let archive = ScanArchive()
    private var captureLimit = 1_000_000
    private var archiveEnabled = false
    private var accumulator = ScanAccumulator(spacing: 0.005, limit: 1_000_000)
    private var lastFrame: TimeInterval = 0
    // Mutable capture state lives exclusively on queue; UI state exclusively on main.
    private var captureEnabled = true
    private var maxDepth: Float = 3
    private var closed = false
    private var frozen = false
    private var saving = false
    private var previewPending = false // queue-owned, at most one UI update in flight
    private var displayedPoints: [ScanPoint] = []
    private var displayCount = 0
    private var lastLookUpdate: CFTimeInterval = 0

    override func viewDidLoad() {
        super.viewDidLoad()
        title = liveMode ? "Depth Playground" : "LiDAR Scan"
        view.backgroundColor = UIColor(red: 0.035, green: 0.04, blue: 0.055, alpha: 1)
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Done", style: .done, target: self, action: #selector(close))
        sceneView.backgroundColor = .black
        sceneView.scene = SCNScene()
        camera.camera = SCNCamera(); camera.camera?.zNear = 0.02; camera.camera?.zFar = 30
        sceneView.scene?.rootNode.addChildNode(camera)
        sceneView.scene?.rootNode.addChildNode(cloud)
        sceneView.pointOfView = camera
        sceneView.preferredFramesPerSecond = 30
        status.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium)
        status.textColor = .lightGray; status.numberOfLines = 2; status.textAlignment = .center
        status.text = "Move slowly. Point at a textured surface to begin."
        freeze.setTitle("Freeze / orbit", for: .normal)
        freeze.addTarget(self, action: #selector(toggleFreeze), for: .touchUpInside)
        save.setTitle("Save scan", for: .normal); save.isEnabled = false
        save.addTarget(self, action: #selector(saveScan), for: .touchUpInside)
        let reset = UIButton(type: .system); reset.setTitle("New scan", for: .normal)
        reset.addTarget(self, action: #selector(resetScan), for: .touchUpInside)
        effects.selectedSegmentIndex = 0; effects.addTarget(self, action: #selector(updateLook), for: .valueChanged)
        amount.minimumValue = 0; amount.maximumValue = 1; amount.value = 0.45
        amount.accessibilityLabel = "Depth effect intensity"
        amount.addTarget(self, action: #selector(sliderLook), for: .valueChanged)
        amount.addTarget(self, action: #selector(updateLook), for: [.touchUpInside, .touchUpOutside, .touchCancel])
        quality.selectedSegmentIndex = 1; quality.addTarget(self, action: #selector(changeQuality), for: .valueChanged)
        range.selectedSegmentIndex = 0; range.addTarget(self, action: #selector(changeRange), for: .valueChanged)
        let hint = UILabel(); hint.text = "Freeze to orbit • Cell size is not sensor accuracy • PLY keeps original colors"
        hint.textColor = .gray; hint.font = .systemFont(ofSize: 11); hint.numberOfLines = 2; hint.textAlignment = .center
        let buttons = UIStackView(arrangedSubviews: [reset, freeze, save]); buttons.distribution = .fillEqually
        let controls = UIStackView(arrangedSubviews: [status, quality, range, effects, amount, buttons, hint])
        controls.axis = .vertical; controls.spacing = 10
        for child in [sceneView, controls] { child.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(child) }
        NSLayoutConstraint.activate([
            sceneView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), sceneView.leadingAnchor.constraint(equalTo: view.leadingAnchor), sceneView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            sceneView.bottomAnchor.constraint(equalTo: controls.topAnchor, constant: -12),
            controls.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16), controls.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16), controls.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -10),
            buttons.heightAnchor.constraint(equalToConstant: 44)
        ])
        session.delegate = self; session.delegateQueue = queue
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
        run(reset: true)
    }
    private func run(reset: Bool) {
        let config = ARWorldTrackingConfiguration()
        config.frameSemantics = .sceneDepth
        session.run(config, options: reset ? [.resetTracking, .removeExistingAnchors] : [])
    }
    @objc private func background() { if !frozen { setFrozen(true) } }
    private func setFrozen(_ value: Bool) {
        frozen = value; sceneView.allowsCameraControl = value
        freeze.setTitle(value ? "Resume capture" : "Freeze / orbit", for: .normal)
        queue.async { self.captureEnabled = !value }
        if value {
            session.pause()
            if !displayedPoints.isEmpty {
                let center = displayedPoints.reduce(SIMD3<Float>(repeating: 0)) { $0 + $1.position } / Float(displayedPoints.count)
                sceneView.defaultCameraController.target = SCNVector3(center)
                sceneView.defaultCameraController.interactionMode = .orbitTurntable
            }
        } else { sceneView.pointOfView = camera; run(reset: false) }
    }
    @objc private func toggleFreeze() { guard !saving else { return }; setFrozen(!frozen) }
    @objc private func changeQuality() {
        // Changing density starts a new scan; never silently discard unsaved geometry.
        let selected = quality.selectedSegmentIndex
        let alert = UIAlertController(title: "Change scan detail?", message: ["Fast: 1 cm cells, 300,000 points. Lower memory use.", "Detail: every depth pixel, 5 mm cells, 1 million points.", "Fine: every depth pixel, 3 mm cells, up to 5 million exported points. Full detail is stored on disk; the preview stays light. Move slowly and scan close. Cell size is not sensor accuracy."][selected] + " Unsaved points will be cleared.", preferredStyle: .alert)
        quality.selectedSegmentIndex = accumulatorSpacingIndex
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Start new scan", style: .destructive) { _ in
            guard !self.saving else { return }; self.session.pause(); self.quality.selectedSegmentIndex = selected; self.accumulatorSpacingIndex = selected
            self.queue.async {
                self.accumulator = ScanAccumulator(spacing: [0.01, 0.005, 0.003][selected], limit: [300_000, 1_000_000, 300_000][selected]); self.archive.clear(); self.archiveEnabled = selected == 2 && !self.liveMode; self.captureLimit = [300_000, 1_000_000, 5_000_000][selected]; self.samplingStep = selected == 0 ? 2 : 1; self.frameInterval = selected == 0 ? 0.2 : 0.15; self.captureEnabled = true; self.lastFrame = 0
                DispatchQueue.main.async { self.displayedPoints = []; self.displayCount = 0; self.cloud.geometry = nil; self.save.isEnabled = false; self.frozen = false; self.sceneView.allowsCameraControl = false; self.sceneView.pointOfView = self.camera; self.freeze.setTitle("Freeze / orbit", for: .normal); self.run(reset: true) }
            }
        }); present(alert, animated: true)
    }
    private var accumulatorSpacingIndex = 1
    @objc private func changeRange() {
        let distance: Float = range.selectedSegmentIndex == 0 ? 3 : 6
        queue.async { self.maxDepth = distance }
    }
    @objc private func resetScan() {
        guard !saving else { return }
        let alert = UIAlertController(title: "Start a new scan?", message: "Unsaved points will be cleared. Saved scans stay in your toolkit.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "New scan", style: .destructive) { _ in
            self.session.pause()
            self.queue.async { self.accumulator.clear(); self.archive.clear(); self.lastFrame = 0; self.captureEnabled = true
                DispatchQueue.main.async { self.displayedPoints = []; self.displayCount = 0; self.cloud.geometry = nil; self.save.isEnabled = false; self.frozen = false; self.sceneView.allowsCameraControl = false; self.sceneView.pointOfView = self.camera; self.freeze.setTitle("Freeze / orbit", for: .normal); self.run(reset: true) }
            }
        }); present(alert, animated: true)
    }
    @objc private func close() {
        guard !saving, !closed else { return }; closed = true; session.pause()
        queue.async { self.captureEnabled = false }
        dismiss(animated: true) { self.onDone?() }
    }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); if isBeingDismissed || navigationController?.isBeingDismissed == true { session.pause() } }
    deinit { session.pause(); NotificationCenter.default.removeObserver(self) }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard captureEnabled, !previewPending, frame.timestamp - lastFrame >= frameInterval else { return }
        lastFrame = frame.timestamp
        guard case .normal = frame.camera.trackingState else {
            DispatchQueue.main.async { if !self.frozen { self.status.text = "Finding position… move slowly in good light." } }; return
        }
        guard let depth = frame.sceneDepth, let confidence = depth.confidenceMap else { return }
        let buffer = depth.depthMap, image = frame.capturedImage
        guard CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_DepthFloat32, CVPixelBufferGetPlaneCount(image) >= 2 else { return }
        CVPixelBufferLockBaseAddress(buffer, .readOnly); CVPixelBufferLockBaseAddress(confidence, .readOnly); CVPixelBufferLockBaseAddress(image, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly); CVPixelBufferUnlockBaseAddress(confidence, .readOnly); CVPixelBufferUnlockBaseAddress(image, .readOnly) }
        guard let depthBase = CVPixelBufferGetBaseAddress(buffer), let confBase = CVPixelBufferGetBaseAddress(confidence), let yBase = CVPixelBufferGetBaseAddressOfPlane(image, 0), let uvBase = CVPixelBufferGetBaseAddressOfPlane(image, 1) else { return }
        let w = CVPixelBufferGetWidth(buffer), h = CVPixelBufferGetHeight(buffer)
        let iw = CVPixelBufferGetWidthOfPlane(image, 0), ih = CVPixelBufferGetHeightOfPlane(image, 0)
        let dw = CVPixelBufferGetBytesPerRow(buffer) / MemoryLayout<Float>.size, cw = CVPixelBufferGetBytesPerRow(confidence)
        let yw = CVPixelBufferGetBytesPerRowOfPlane(image, 0), uvw = CVPixelBufferGetBytesPerRowOfPlane(image, 1)
        let d = depthBase.assumingMemoryBound(to: Float.self), c = confBase.assumingMemoryBound(to: UInt8.self)
        let ys = yBase.assumingMemoryBound(to: UInt8.self), uvs = uvBase.assumingMemoryBound(to: UInt8.self)
        let intrinsics = frame.camera.intrinsics
        let sx = Float(w) / Float(iw), sy = Float(h) / Float(ih)
        if liveMode { accumulator.clear() }
        let matrix = CVBufferCopyAttachment(image, kCVImageBufferYCbCrMatrixKey, nil) as? String
        let is709 = matrix == (kCVImageBufferYCbCrMatrix_ITU_R_709_2 as String)
        let videoRange = CVPixelBufferGetPixelFormatType(image) == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        for y in stride(from: 0, to: h, by: samplingStep) { for x in stride(from: 0, to: w, by: samplingStep) {
            let z = d[y * dw + x]
            guard c[y * cw + x] >= 1, z.isFinite, z > 0.2, z < maxDepth else { continue }
            let ix = min(iw - 1, Int((Float(x) + 0.5) / sx)), iy = min(ih - 1, Int((Float(y) + 0.5) / sy))
            let l = Float(ys[iy * yw + ix]), cb = Float(uvs[(iy / 2) * uvw + (ix / 2) * 2]) - 128, cr = Float(uvs[(iy / 2) * uvw + (ix / 2) * 2 + 1]) - 128
            func byte(_ v: Float) -> UInt8 { UInt8(max(0, min(255, v))) }
            let lum = videoRange ? (l - 16) * (255 / 219.0) : l
            let u = videoRange ? cb * (255 / 224.0) : cb, v = videoRange ? cr * (255 / 224.0) : cr
            let color = is709 ? SIMD3(byte(lum + 1.5748 * v), byte(lum - 0.1873 * u - 0.4681 * v), byte(lum + 1.8556 * u)) : SIMD3(byte(lum + 1.402 * v), byte(lum - 0.344136 * u - 0.714136 * v), byte(lum + 1.772 * u))
            let p = scanWorldPoint(x: Float(x) + 0.5, y: Float(y) + 0.5, depth: z, fx: intrinsics[0,0] * sx, fy: intrinsics[1,1] * sy, cx: intrinsics[2,0] * sx, cy: intrinsics[2,1] * sy, transform: frame.camera.transform)
            if let key = accumulator.key(for: p), !archive.keys.contains(key), accumulator.voxels[key] != nil || archive.count + accumulator.count < captureLimit {
                accumulator.insert(ScanPoint(position: p, color: color, depth: z))
            }
        } }
        if archiveEnabled && accumulator.count >= 250_000 {
            do { try archive.flush(&accumulator) } catch { captureEnabled = false; DispatchQueue.main.async { self.setFrozen(true); self.status.text = "Scan storage full: \(error.localizedDescription). Save the captured points before continuing." }; return }
        }
        let count = archive.count + accumulator.count, step = max(1, Int(ceil(Double(accumulator.count) / (archive.count > 0 ? 40_000 : 80_000))))
        let limitReached = count >= captureLimit
        let preview = archive.preview + accumulator.voxels.values.enumerated().compactMap { $0.offset % step == 0 ? $0.element : nil }
        previewPending = true
        DispatchQueue.main.async {
            defer { self.queue.async { self.previewPending = false } }
            guard !self.closed else { return }
            self.displayedPoints = preview; self.displayCount = count
            if !self.frozen {
                let orientation = self.view.window?.windowScene?.interfaceOrientation ?? .portrait
                let size = self.sceneView.bounds.size
                self.camera.simdTransform = frame.camera.viewMatrix(for: orientation).inverse
                self.camera.camera?.projectionTransform = SCNMatrix4(frame.camera.projectionMatrix(for: orientation, viewportSize: size, zNear: 0.02, zFar: 30))
                self.sceneView.pointOfView = self.camera
            }
            self.status.text = "\(count.formatted()) points · \(self.liveMode ? "Live depth" : "Scanning")\(limitReached ? " · Scan limit reached" : "")"
            self.save.isEnabled = count > 0 && !self.saving
            self.updateLook()
        }
    }
    @objc private func sliderLook() {
        let now = CACurrentMediaTime()
        guard now - lastLookUpdate >= 1.0 / 15 else { return }
        updateLook()
    }
    @objc private func updateLook() {
        lastLookUpdate = CACurrentMediaTime()
        let style = effects.selectedSegmentIndex, strength = amount.value
        var vertices: [SCNVector3] = [], colors: [Float] = []
        vertices.reserveCapacity(displayedPoints.count); colors.reserveCapacity(displayedPoints.count * 4)
        for p in displayedPoints {
            // Stable spatial hash avoids flickering dissolve as the voxel dictionary grows.
            let hash = abs(sin(p.position.x * 91.7 + p.position.y * 37.1 + p.position.z * 17.3) * 43758.5453).truncatingRemainder(dividingBy: 1)
            if style == 3 && hash < strength * 0.94 { continue }
            vertices.append(SCNVector3(p.position))
            var rgb = SIMD3<Float>(Float(p.color.x), Float(p.color.y), Float(p.color.z)) / 255
            if style == 1 { let t = min(1, p.depth / (range.selectedSegmentIndex == 0 ? 3 : 6)); rgb = SIMD3(1 - t, 0.25 + 0.7 * sin(t * .pi), t) }
            if style == 2 { let t = p.depth * (2 + strength * 12); rgb = SIMD3(0.35 + 0.65 * sin(t) * sin(t), 0.15 + 0.7 * cos(t) * cos(t), 1) }
            colors.append(contentsOf: [rgb.x, rgb.y, rgb.z, 1])
        }
        let position = SCNGeometrySource(vertices: vertices)
        let colorData = colors.withUnsafeBytes { Data($0) }
        let color = SCNGeometrySource(data: colorData, semantic: .color, vectorCount: vertices.count, usesFloatComponents: true, componentsPerVector: 4, bytesPerComponent: 4, dataOffset: 0, dataStride: 16)
        let element = SCNGeometryElement(data: nil, primitiveType: .point, primitiveCount: vertices.count, bytesPerIndex: 0)
        element.pointSize = CGFloat(2 + strength * 5); element.minimumPointScreenSpaceRadius = 1; element.maximumPointScreenSpaceRadius = CGFloat(2 + strength * 4)
        let geometry = SCNGeometry(sources: [position, color], elements: [element])
        let material = SCNMaterial(); material.lightingModel = .constant; material.diffuse.contents = UIColor.white; material.isDoubleSided = true
        geometry.materials = [material]; cloud.geometry = geometry
    }
    @objc private func saveScan() {
        guard !saving, displayCount > 0 else { return }; setFrozen(true)
        let alert = UIAlertController(title: "Save point cloud", message: "Full-resolution colored PLY, in meters. Share to Files or AirDrop from the toolkit.", preferredStyle: .alert)
        alert.addTextField { $0.placeholder = "Scan name"; $0.text = self.liveMode ? "Depth capture" : "LiDAR scan" }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Save", style: .default) { _ in
            let name = String((alert.textFields?.first?.text ?? "Scan").trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
            self.saving = true; self.save.isEnabled = false; self.freeze.isEnabled = false
            self.navigationItem.rightBarButtonItem?.isEnabled = false
            let thumbnail = self.sceneView.snapshot().jpegData(compressionQuality: 0.75)
            self.status.text = "Saving scan…"
            self.queue.async {
                do { _ = try ScanFiles.save(points: self.accumulator.points, name: name.isEmpty ? "Scan" : name, mode: self.liveMode ? "depth" : "lidar", thumbnail: thumbnail, chunks: self.archive.chunks, archivedCount: self.archive.count)
                    DispatchQueue.main.async { self.finishSave("Saved. Find your scan in the toolkit.") }
                } catch { DispatchQueue.main.async { self.finishSave("Save failed: \(error.localizedDescription)") } }
            }
        }); present(alert, animated: true)
    }
    private func finishSave(_ message: String) { saving = false; save.isEnabled = true; freeze.isEnabled = true; navigationItem.rightBarButtonItem?.isEnabled = true; status.text = message }
    func session(_ session: ARSession, didFailWithError error: Error) { DispatchQueue.main.async { self.setFrozen(true); self.status.text = error.localizedDescription } }
    func sessionWasInterrupted(_ session: ARSession) { DispatchQueue.main.async { self.setFrozen(true); self.status.text = "Capture interrupted. Resume when ready." } }
}
