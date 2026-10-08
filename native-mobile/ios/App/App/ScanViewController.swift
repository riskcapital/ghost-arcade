import UIKit
import ARKit
import SceneKit
import os
import AVFoundation

/// LiDAR scanner and depth playground. Capture is isolated from the web renderer: only saved files cross the bridge.
/// All scan maths lives in ScanCore.swift (tested on the Mac); this file is the camera, the screen and the controls.
final class ScanViewController: UIViewController, ARSessionDelegate {
    var liveMode = false
    var onDone: (() -> Void)?

    // Views. `liveView` shows the camera, dimmed, with the cloud drawn on top in world space.
    // `reviewView` shows the cleaned result while paused, free to orbit.
    private let liveView = ARSCNView()
    private let reviewView = SCNView()
    private let liveCloud = SCNNode()
    private let reviewCloud = SCNNode()
    private let status = UILabel()
    private let hint = UILabel()
    private let detail = UISegmentedControl(items: ["Performance", "Balanced", "Detail"])
    private let range = UISegmentedControl(items: ["Object · 2.5 m", "Room · 5 m"])
    private lazy var looks = UISegmentedControl(items: liveMode ? ["Color", "Depth", "Neon", "Dissolve"] : ["Color", "Coverage", "Depth"])
    private let amount = UISlider()
    private let cropSwitch = UISwitch()
    private let cropLabel = UILabel()
    private let clearButton = UIButton(type: .system)
    private let undoButton = UIButton(type: .system)
    private let pauseButton = UIButton(type: .system)
    private let saveButton = UIButton(type: .system)

    // Capture state: touched only on `queue`.
    private let queue = DispatchQueue(label: "live.ghostarcade.scan", qos: .userInitiated)
    private var session: ARSession { liveView.session }
    private var accumulator = ScanAccumulator(preset: .balanced)
    private var capturing = false
    private var rgb = [UInt8]()
    private var lastMerge: TimeInterval = 0
    private var lastMergePose = matrix_identity_float4x4
    private var lastPose = matrix_identity_float4x4
    private var lastPoseTime: TimeInterval = 0
    private var lastPreview: TimeInterval = 0
    private var lastGuard: TimeInterval = 0
    private var recentNew: Float = 1
    private var trackingLost = false
    private var whiteBalanceLocked = false
    private var mergeInterval: TimeInterval = 0.1
    private var previewPending = false
    private var look = ScanLook.color
    private var strength: Float = 0.45
    private var cropWanted = true
    private var result: ScanResult?

    // Screen state: touched only on the main thread.
    private var paused = false
    private var saving = false
    private var closed = false
    private var pointCount = 0
    private var presetIndex = 1
    private let supported = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)

    override func viewDidLoad() {
        super.viewDidLoad()
        title = liveMode ? "Depth Playground" : "LiDAR Scan"
        view.backgroundColor = UIColor(red: 0.035, green: 0.04, blue: 0.055, alpha: 1)
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Done", style: .done, target: self, action: #selector(close))
        liveView.scene = SCNScene(); liveView.scene.rootNode.addChildNode(liveCloud)
        liveView.automaticallyUpdatesLighting = false; liveView.rendersCameraGrain = false; liveView.rendersMotionBlur = false
        liveView.scene.background.intensity = 0.35 // dim the camera so the captured points stand out
        liveView.preferredFramesPerSecond = 30; liveView.backgroundColor = .black
        reviewView.scene = SCNScene(); reviewView.scene?.rootNode.addChildNode(reviewCloud)
        reviewView.backgroundColor = .black; reviewView.allowsCameraControl = true; reviewView.isHidden = true
        reviewView.defaultCameraController.interactionMode = .orbitTurntable
        let eye = SCNNode(); eye.camera = SCNCamera(); eye.camera?.zNear = 0.02; eye.camera?.zFar = 60; eye.camera?.fieldOfView = 50
        reviewView.scene?.rootNode.addChildNode(eye); reviewView.pointOfView = eye
        status.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium); status.textColor = .lightGray; status.textAlignment = .center; status.numberOfLines = 2
        hint.font = .systemFont(ofSize: 15, weight: .semibold); hint.textColor = UIColor(red: 1, green: 0.78, blue: 0.35, alpha: 1); hint.textAlignment = .center; hint.numberOfLines = 2
        hint.text = " "
        detail.selectedSegmentIndex = presetIndex; detail.addTarget(self, action: #selector(changeDetail), for: .valueChanged)
        range.selectedSegmentIndex = 0; range.addTarget(self, action: #selector(changeRange), for: .valueChanged)
        looks.selectedSegmentIndex = 0; looks.addTarget(self, action: #selector(changeLook), for: .valueChanged)
        amount.minimumValue = 0; amount.maximumValue = 1; amount.value = strength; amount.accessibilityLabel = "Depth effect intensity"
        amount.addTarget(self, action: #selector(changeLook), for: .valueChanged)
        cropLabel.text = "Crop to subject"; cropLabel.textColor = .lightGray; cropLabel.font = .systemFont(ofSize: 14)
        cropSwitch.isOn = true; cropSwitch.addTarget(self, action: #selector(changeCrop), for: .valueChanged)
        let cropRow = UIStackView(arrangedSubviews: [cropLabel, cropSwitch]); cropRow.distribution = .equalSpacing; cropRow.alignment = .center
        for (button, title, action) in [(clearButton, "Clear", #selector(clearScan)), (undoButton, "Undo", #selector(undoSweep)), (pauseButton, "Pause", #selector(togglePause)), (saveButton, "Save", #selector(saveScan))] {
            button.setTitle(title, for: .normal); button.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold); button.addTarget(self, action: action, for: .touchUpInside)
        }
        undoButton.accessibilityLabel = "Undo last sweep"; undoButton.isEnabled = false
        let buttons = UIStackView(arrangedSubviews: liveMode ? [pauseButton, saveButton] : [clearButton, undoButton, pauseButton, saveButton]); buttons.distribution = .fillEqually
        let rows: [UIView] = liveMode ? [status, hint, range, looks, amount, buttons] : [status, hint, detail, range, looks, cropRow, buttons]
        let controls = UIStackView(arrangedSubviews: rows); controls.axis = .vertical; controls.spacing = 8
        for child in [liveView, reviewView, controls] { child.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(child) }
        NSLayoutConstraint.activate([
            liveView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), liveView.leadingAnchor.constraint(equalTo: view.leadingAnchor), liveView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            liveView.bottomAnchor.constraint(equalTo: controls.topAnchor, constant: -10),
            reviewView.topAnchor.constraint(equalTo: liveView.topAnchor), reviewView.bottomAnchor.constraint(equalTo: liveView.bottomAnchor), reviewView.leadingAnchor.constraint(equalTo: liveView.leadingAnchor), reviewView.trailingAnchor.constraint(equalTo: liveView.trailingAnchor),
            controls.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16), controls.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            controls.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8), buttons.heightAnchor.constraint(equalToConstant: 44),
        ])
        refreshButtons()
        guard supported else {
            // Reached only if the screen is opened on a device without LiDAR; the toolkit normally blocks that.
            status.text = "This device has no LiDAR sensor."; hint.text = "LiDAR scanning needs an iPhone Pro or iPad Pro."
            for control in [detail, range, looks, cropSwitch, amount] as [UIControl] { control.isEnabled = false }
            liveView.isHidden = true
            return
        }
        status.text = liveMode ? "Live depth" : "Move slowly around what you want to scan."
        session.delegate = self; session.delegateQueue = queue
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(appLeft), name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(heatChanged), name: ProcessInfo.thermalStateDidChangeNotification, object: nil)
        queue.async { self.accumulator.maxDepth = 2.5; self.capturing = true }
        run(reset: true); heatChanged()
    }

    // MARK: Session

    private func run(reset: Bool) {
        let config = ARWorldTrackingConfiguration()
        config.frameSemantics = .sceneDepth // raw depth; averaging happens in the accumulator
        session.run(config, options: reset ? [.resetTracking, .removeExistingAnchors] : [])
    }
    /// Holds the white balance once the scan is under way, so colours do not shift between sweeps.
    /// Exposure stays automatic; the accumulator matches brightness between frames.
    private func setWhiteBalanceLocked(_ locked: Bool) {
        guard let device = ARWorldTrackingConfiguration.configurableCaptureDeviceForPrimaryCamera else { return }
        let mode: AVCaptureDevice.WhiteBalanceMode = locked ? .locked : .continuousAutoWhiteBalance
        guard device.isWhiteBalanceModeSupported(mode), (try? device.lockForConfiguration()) != nil else { return }
        device.whiteBalanceMode = mode; device.unlockForConfiguration()
    }
    @objc private func appLeft() { if !paused { setPaused(true, message: "Paused while the app was in the background.") } }
    @objc private func heatChanged() {
        let state = ProcessInfo.processInfo.thermalState
        queue.async { self.mergeInterval = state == .nominal || state == .fair ? 0.1 : 0.25 }
        DispatchQueue.main.async {
            if state == .critical, !self.paused { self.setPaused(true, message: "The device is too hot. Save your scan and let it cool down.") }
            else if state == .serious, !self.paused { self.hint.text = "The device is warm. Scanning a little slower." }
        }
    }
    override func didReceiveMemoryWarning() {
        super.didReceiveMemoryWarning()
        if !paused { setPaused(true, message: "Memory is low. Save this scan before adding more.") }
    }

    private func refreshButtons() {
        let busy = saving || !supported
        pauseButton.setTitle(paused ? "Resume" : "Pause", for: .normal); pauseButton.isEnabled = !busy
        saveButton.isEnabled = !busy && pointCount > 0
        clearButton.isEnabled = !busy && pointCount > 0
        detail.isEnabled = !busy; navigationItem.rightBarButtonItem?.isEnabled = !saving
        cropSwitch.isEnabled = !busy && range.selectedSegmentIndex == 0
        cropLabel.alpha = cropSwitch.isEnabled ? 1 : 0.4
    }

    /// Pausing stops the camera, cleans the cloud and shows exactly what Save will write.
    private func setPaused(_ value: Bool, message: String? = nil) {
        guard supported, paused != value else { return }
        paused = value; refreshButtons()
        if value {
            session.pause(); hint.text = message ?? " "; status.text = "Cleaning up…"
            queue.async { self.capturing = false; self.buildResult() }
        } else {
            reviewView.isHidden = true; liveView.isHidden = false; hint.text = pointCount > 0 ? "Point at a part you already scanned." : " "
            status.text = "\(pointCount.formatted()) points"
            queue.async {
                self.result = nil; self.accumulator.beginSweep(); self.capturing = true; self.lastMerge = 0; self.lastPoseTime = 0; self.recentNew = 1
            }
            run(reset: false)
        }
    }
    /// queue: clean the cloud and hand the review picture to the screen.
    private func buildResult() {
        var options = ScanFinalizeOptions()
        options.autoCrop = cropWanted && !liveMode
        if liveMode { options.minFrames = 1; options.alignWalls = false }
        let cleaned = accumulator.finalize(options)
        result = cleaned
        let picture = scanPreview(of: cleaned, maxPoints: 400_000), geometry = Self.geometry(picture, pointSize: cleaned.voxel)
        let size = cleaned.boundsMax - cleaned.boundsMin, undo = accumulator.sweep > 0 && accumulator.canUndo
        DispatchQueue.main.async {
            guard !self.closed, self.paused else { return }
            self.reviewCloud.geometry = geometry; self.pointCount = cleaned.count; self.undoButton.isEnabled = undo && !self.saving
            self.liveView.isHidden = true; self.reviewView.isHidden = false
            let reach = max(size.x, size.y, size.z, 0.2)
            // Same view the desktop opens with: from +Z, level, looking at the middle.
            self.reviewView.pointOfView?.simdPosition = picture.center + SIMD3<Float>(0, reach * 0.15, reach * 1.35)
            self.reviewView.pointOfView?.simdLook(at: picture.center)
            self.reviewView.defaultCameraController.target = SCNVector3(picture.center)
            self.status.text = cleaned.count > 0
                ? "\(cleaned.count.formatted()) points · \(String(format: "%.2f × %.2f × %.2f m", size.x, size.y, size.z))\nDrag to look around. This is what Save writes."
                : "Nothing solid captured yet. Resume and move slowly."
            self.refreshButtons()
        }
    }

    // MARK: Controls

    @objc private func togglePause() { guard !saving else { return }; setPaused(!paused) }
    @objc private func changeRange() {
        let object = range.selectedSegmentIndex == 0
        if !liveMode { cropSwitch.isOn = object }
        refreshButtons()
        let wantCrop = cropSwitch.isOn
        queue.async { self.accumulator.maxDepth = object ? 2.5 : 5; self.cropWanted = wantCrop; if !self.capturing { self.buildResult() } }
    }
    @objc private func changeCrop() { let want = cropSwitch.isOn; queue.async { self.cropWanted = want; if !self.capturing { self.buildResult() } } }
    @objc private func changeLook() {
        let index = looks.selectedSegmentIndex, value = amount.value
        let chosen: ScanLook = liveMode ? [.color, .depth, .neon, .dissolve][index] : [.color, .coverage, .depth][index]
        queue.async { self.look = chosen; self.strength = value; self.lastPreview = 0 }
        if chosen == .coverage, !paused { hint.text = "Orange points were seen once. Pass over them again." }
    }
    @objc private func changeDetail() {
        let selected = detail.selectedSegmentIndex
        guard pointCount > 0 else { applyDetail(selected); return }
        // Changing detail starts a new scan; never silently discard unsaved points.
        detail.selectedSegmentIndex = presetIndex
        let note = ["Performance: 12 mm spacing, up to 250,000 points. Lightest on the desktop.", "Balanced: 8 mm spacing, up to 500,000 points.", "Detail: 5 mm spacing, up to 1,500,000 points. Scan close and slowly."][selected]
        let alert = UIAlertController(title: "Change scan detail?", message: note + " Unsaved points will be cleared.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Start new scan", style: .destructive) { _ in self.detail.selectedSegmentIndex = selected; self.applyDetail(selected) })
        present(alert, animated: true)
    }
    private func applyDetail(_ index: Int) { presetIndex = index; restart(preset: ScanPreset.all[index]) }
    @objc private func clearScan() {
        guard !saving else { return }
        let alert = UIAlertController(title: "Clear this scan?", message: "Unsaved points will be removed. Saved scans stay in your toolkit.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Clear", style: .destructive) { _ in self.restart(preset: ScanPreset.all[self.presetIndex]) })
        present(alert, animated: true)
    }
    /// Empties the scan and starts tracking afresh.
    private func restart(preset: ScanPreset) {
        guard supported, !saving else { return }
        session.pause(); paused = false; pointCount = 0
        liveCloud.geometry = nil; reviewCloud.geometry = nil; reviewView.isHidden = true; liveView.isHidden = false
        undoButton.isEnabled = false; status.text = "Move slowly around what you want to scan."; hint.text = " "; refreshButtons()
        let far: Float = range.selectedSegmentIndex == 0 ? 2.5 : 5
        setWhiteBalanceLocked(false)
        queue.async {
            self.accumulator = ScanAccumulator(preset: preset); self.accumulator.maxDepth = far; self.result = nil
            self.capturing = true; self.lastMerge = 0; self.lastPoseTime = 0; self.recentNew = 1; self.trackingLost = false; self.whiteBalanceLocked = false
            DispatchQueue.main.async { if !self.closed, !self.paused { self.run(reset: true) } }
        }
    }
    @objc private func undoSweep() {
        guard !saving else { return }
        undoButton.isEnabled = false
        queue.async {
            let removed = self.accumulator.undoLastSweep(), left = self.accumulator.count, more = self.accumulator.sweep > 0 && self.accumulator.canUndo
            if !self.capturing { self.buildResult() } else { self.lastPreview = 0 }
            DispatchQueue.main.async { self.pointCount = left; self.undoButton.isEnabled = more; self.hint.text = "Removed the last sweep (\(removed.formatted()) points)."; self.refreshButtons() }
        }
    }
    @objc private func close() {
        guard !saving, !closed else { return }
        closed = true; session.pause(); setWhiteBalanceLocked(false)
        NotificationCenter.default.removeObserver(self)
        queue.async { self.capturing = false; self.accumulator.clear(); self.result = nil }
        dismiss(animated: true) { self.onDone?() }
    }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); if isBeingDismissed || navigationController?.isBeingDismissed == true { session.pause() } }
    deinit { NotificationCenter.default.removeObserver(self) }

    // MARK: Frames (queue)

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard capturing else { return }
        let now = frame.timestamp, pose = frame.camera.transform
        // How fast the device is moving, from one camera frame to the next.
        var speed: Float = 0, turn: Float = 0
        if lastPoseTime > 0, now > lastPoseTime {
            let dt = Float(now - lastPoseTime)
            speed = simd_distance(pose.columns.3, lastPose.columns.3) / dt
            turn = acos(min(1, max(-1, simd_dot(pose.columns.2, lastPose.columns.2)))) * 180 / .pi / dt
        }
        lastPose = pose; lastPoseTime = now
        guard !previewPending, now - lastMerge >= mergeInterval else { return }
        // Tracking lost: add nothing (points would land in the wrong place) and say what to do.
        if case .normal = frame.camera.trackingState {} else {
            lastMerge = now; trackingLost = true
            let message: String
            switch frame.camera.trackingState {
            case .limited(.excessiveMotion): message = "Tracking lost: moving too fast. Hold still, then go slower."
            case .limited(.insufficientFeatures): message = "Tracking lost: not enough detail or light here. Aim at a textured area."
            case .limited(.relocalizing): message = "Finding where you were. Point at a part you already scanned."
            case .limited(.initializing): message = "Getting ready. Move the device slowly."
            default: message = "Tracking lost. Scanning is on hold."
            }
            DispatchQueue.main.async { if !self.paused, !self.closed { self.hint.text = message } }
            return
        }
        // Tracking is back. What follows is a new sweep, so it can be undone if it lands misaligned.
        if trackingLost { trackingLost = false; if !liveMode { accumulator.beginSweep() } }
        if scanTooFastToMerge(speed: speed, turn: turn) { DispatchQueue.main.async { if !self.paused { self.hint.text = ScanHint.moveSlower.text } }; return }
        // Standing still adds nothing new: merge now and then for noise, not every frame.
        let moved = simd_distance(pose.columns.3, lastMergePose.columns.3), turned = acos(min(1, max(-1, simd_dot(pose.columns.2, lastMergePose.columns.2)))) * 180 / .pi
        if !liveMode, accumulator.count > 0, moved < 0.015, turned < 1.5, now - lastMerge < 0.6 { return }
        guard let depth = frame.sceneDepth else { return }
        let buffer = depth.depthMap, image = frame.capturedImage, confidence = depth.confidenceMap
        guard CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_DepthFloat32, CVPixelBufferGetPlaneCount(image) >= 2 else { return }
        CVPixelBufferLockBaseAddress(buffer, .readOnly); CVPixelBufferLockBaseAddress(image, .readOnly)
        if let confidence = confidence { CVPixelBufferLockBaseAddress(confidence, .readOnly) }
        defer {
            CVPixelBufferUnlockBaseAddress(buffer, .readOnly); CVPixelBufferUnlockBaseAddress(image, .readOnly)
            if let confidence = confidence { CVPixelBufferUnlockBaseAddress(confidence, .readOnly) }
        }
        guard let depthBase = CVPixelBufferGetBaseAddress(buffer), let yBase = CVPixelBufferGetBaseAddressOfPlane(image, 0), let uvBase = CVPixelBufferGetBaseAddressOfPlane(image, 1) else { return }
        let w = CVPixelBufferGetWidth(buffer), h = CVPixelBufferGetHeight(buffer)
        let iw = CVPixelBufferGetWidthOfPlane(image, 0), ih = CVPixelBufferGetHeightOfPlane(image, 0)
        guard w >= 3, h >= 3, iw >= 8, ih >= 8 else { return }
        fillColors(width: w, height: h, imageWidth: iw, imageHeight: ih, luma: yBase.assumingMemoryBound(to: UInt8.self), lumaRow: CVPixelBufferGetBytesPerRowOfPlane(image, 0),
                   chroma: uvBase.assumingMemoryBound(to: UInt8.self), chromaRow: CVPixelBufferGetBytesPerRowOfPlane(image, 1), image: image)
        // Intrinsics are given for the camera image; the depth map covers the same view at lower resolution.
        let k = frame.camera.intrinsics, sx = Float(w) / Float(iw), sy = Float(h) / Float(ih)
        let confidenceBase = confidence.flatMap { CVPixelBufferGetBaseAddress($0) }?.assumingMemoryBound(to: UInt8.self)
        let stats = rgb.withUnsafeBufferPointer { colors in
            accumulator.integrate(ScanFrame(width: w, height: h, depth: depthBase.assumingMemoryBound(to: Float.self), depthRow: CVPixelBufferGetBytesPerRow(buffer) / MemoryLayout<Float>.size,
                                            confidence: confidenceBase, confidenceRow: confidence.map { CVPixelBufferGetBytesPerRow($0) } ?? 0, rgb: colors.baseAddress!,
                                            fx: k[0, 0] * sx, fy: k[1, 1] * sy, cx: k[2, 0] * sx, cy: k[2, 1] * sy, transform: pose), singleFrame: liveMode)
        }
        lastMerge = now; lastMergePose = pose
        recentNew = recentNew * 0.8 + stats.newFraction * 0.2
        if !whiteBalanceLocked, !liveMode, accumulator.frameCount >= 8 { whiteBalanceLocked = true; DispatchQueue.main.async { if !self.closed { self.setWhiteBalanceLocked(true) } } }
        var advice = liveMode ? "" : scanHint(stats: stats, speed: speed, turn: turn, light: frame.lightEstimate.map { Float($0.ambientIntensity) }, recentNew: recentNew, hasPoints: accumulator.count > 2000).text
        if stats.coarsened { advice = "Point limit reached. Spacing is now \(String(format: "%.0f", accumulator.voxel * 1000)) mm." }
        // Memory guard, about once a second.
        var lowMemory = false
        if now - lastGuard > 1 { lastGuard = now; let free = os_proc_available_memory(); lowMemory = free > 0 && free < 220_000_000 }
        guard now - lastPreview >= (liveMode ? 0.08 : 0.3) || lowMemory else { return }
        lastPreview = now
        let eye = SIMD3<Float>(pose.columns.3.x, pose.columns.3.y, pose.columns.3.z)
        let picture = accumulator.preview(maxPoints: 160_000, look: look, strength: strength, eye: eye)
        let geometry = Self.geometry(picture, pointSize: accumulator.voxel * (liveMode ? 1 + strength * 2 : 1.3))
        let count = accumulator.count, undo = accumulator.sweep > 0 && accumulator.canUndo, spacing = accumulator.voxel * 1000
        previewPending = true
        DispatchQueue.main.async {
            defer { self.queue.async { self.previewPending = false } }
            guard !self.closed, !self.paused else { return }
            self.liveCloud.geometry = geometry; self.pointCount = count
            self.status.text = self.liveMode ? "\(count.formatted()) points · Live depth" : "\(count.formatted()) points · \(String(format: "%.0f", spacing)) mm spacing"
            self.hint.text = advice.isEmpty ? " " : advice
            self.undoButton.isEnabled = undo && !self.saving; self.refreshButtons()
            if lowMemory { self.setPaused(true, message: "Memory is low. Save this scan before adding more.") }
        }
    }

    /// queue: one colour per depth pixel. Each depth pixel covers several camera pixels, so average a few.
    private func fillColors(width w: Int, height h: Int, imageWidth iw: Int, imageHeight ih: Int, luma: UnsafePointer<UInt8>, lumaRow: Int, chroma: UnsafePointer<UInt8>, chromaRow: Int, image: CVPixelBuffer) {
        if rgb.count != w * h * 3 { rgb = [UInt8](repeating: 0, count: w * h * 3) }
        let bt709 = (CVBufferCopyAttachment(image, kCVImageBufferYCbCrMatrixKey, nil) as? String) == (kCVImageBufferYCbCrMatrix_ITU_R_709_2 as String)
        let videoRange = CVPixelBufferGetPixelFormatType(image) == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        let scaleX = Float(iw) / Float(w), scaleY = Float(ih) / Float(h)
        let reach = max(1, Int(min(scaleX, scaleY) / 4))
        rgb.withUnsafeMutableBufferPointer { out in
            for y in 0..<h {
                let iy = min(ih - 1 - reach, max(reach, Int((Float(y) + 0.5) * scaleY)))
                for x in 0..<w {
                    let ix = min(iw - 1 - reach, max(reach, Int((Float(x) + 0.5) * scaleX)))
                    let light = (Int(luma[iy * lumaRow + ix]) * 2 + Int(luma[(iy - reach) * lumaRow + ix - reach]) + Int(luma[(iy - reach) * lumaRow + ix + reach])
                                 + Int(luma[(iy + reach) * lumaRow + ix - reach]) + Int(luma[(iy + reach) * lumaRow + ix + reach]))
                    let c = (iy / 2) * chromaRow + (ix / 2) * 2
                    let color = scanRGB(y: Float(light) / 6, cb: Float(chroma[c]), cr: Float(chroma[c + 1]), videoRange: videoRange, bt709: bt709)
                    let o = (y * w + x) * 3
                    out[o] = color.x; out[o + 1] = color.y; out[o + 2] = color.z
                }
            }
        }
    }

    /// Point geometry straight from the packed buffers. Safe to build off the main thread.
    private static func geometry(_ picture: ScanPreview, pointSize: Float) -> SCNGeometry? {
        guard picture.count > 0 else { return nil }
        let position = SCNGeometrySource(data: picture.positions, semantic: .vertex, vectorCount: picture.count, usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: 12)
        let color = SCNGeometrySource(data: picture.colors, semantic: .color, vectorCount: picture.count, usesFloatComponents: true, componentsPerVector: 4, bytesPerComponent: 4, dataOffset: 0, dataStride: 16)
        let element = SCNGeometryElement(data: nil, primitiveType: .point, primitiveCount: picture.count, bytesPerIndex: 0)
        element.pointSize = CGFloat(pointSize); element.minimumPointScreenSpaceRadius = 1.2; element.maximumPointScreenSpaceRadius = 12
        let geometry = SCNGeometry(sources: [position, color], elements: [element])
        let material = SCNMaterial(); material.lightingModel = .constant; material.diffuse.contents = UIColor.white; material.isDoubleSided = true
        geometry.materials = [material]
        return geometry
    }

    // MARK: Save

    @objc private func saveScan() {
        guard !saving, pointCount > 0 else { return }
        setPaused(true)
        let alert = UIAlertController(title: "Save point cloud", message: "Saved as a colored PLY, upright and centered, ready for a Point Cloud layer on desktop.", preferredStyle: .alert)
        alert.addTextField { $0.placeholder = "Scan name"; $0.text = self.liveMode ? "Depth capture" : "LiDAR scan"; $0.autocapitalizationType = .sentences }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Save", style: .default) { _ in
            let typed = (alert.textFields?.first?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let name = String((typed.isEmpty ? "Scan" : typed).prefix(80))
            self.saving = true; self.refreshButtons(); self.undoButton.isEnabled = false
            let thumbnail = self.reviewView.isHidden ? nil : self.reviewView.snapshot().jpegData(compressionQuality: 0.75)
            self.status.text = "Saving scan…"
            let mode = self.liveMode ? "depth" : "lidar"
            self.queue.async {
                if self.result == nil { self.buildResult() }
                let message: String
                if let cleaned = self.result, cleaned.count > 0 {
                    do { _ = try ScanFiles.save(result: cleaned, name: name, mode: mode, preset: self.accumulator.preset.name, thumbnail: thumbnail); message = "Saved \(cleaned.count.formatted()) points. Share it from Saved scans." }
                    catch { message = "Save failed: \(error.localizedDescription)" }
                } else { message = "Nothing solid to save yet. Resume and scan a little longer." }
                DispatchQueue.main.async { self.saving = false; self.status.text = message; self.refreshButtons() }
            }
        })
        present(alert, animated: true)
    }

    func session(_ session: ARSession, didFailWithError error: Error) { DispatchQueue.main.async { self.setPaused(true, message: "Camera stopped: \(error.localizedDescription)") } }
    func sessionWasInterrupted(_ session: ARSession) { DispatchQueue.main.async { self.setPaused(true, message: "Capture was interrupted. Resume when ready.") } }
}
