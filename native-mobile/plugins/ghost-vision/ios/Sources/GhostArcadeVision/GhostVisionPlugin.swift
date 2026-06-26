import Foundation
import AVFoundation
import Capacitor

#if canImport(ARKit)
import ARKit
#endif

#if canImport(Vision)
import Vision
#endif

@objc(GhostVisionPlugin)
public class GhostVisionPlugin: CAPPlugin, CAPBridgedPlugin, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureDepthDataOutputDelegate {
    public let identifier = "GhostVisionPlugin"
    public let jsName = "GhostVision"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    private let sessionQueue = DispatchQueue(label: "live.ghostarcade.vision.session")
    private var captureSession: AVCaptureSession?
    private var videoOutput: AVCaptureVideoDataOutput?
    private var depthOutput: AVCaptureDepthDataOutput?
    private var active = false
    private var currentProfile = "object-relief"
    private var currentFacingMode = "environment"
    private var lastError: String?
    private var lastEmitTime = CFAbsoluteTimeGetCurrent()
    private var targetFrameInterval: CFTimeInterval = 1.0 / 15.0
    private var lastDepthInfo: [String: Any]?
    private var lastDepthSample: [String: Any]?
    private let sampleWidth = 64
    private let sampleHeight = 48

    @objc func getCapabilities(_ call: CAPPluginCall) {
        let profile = call.getString("captureProfile", currentProfile)
        let facingMode = call.getString("facingMode", currentFacingMode)
        call.resolve(capabilitiesObject(profile: profile, facingMode: facingMode))
    }

    @objc func start(_ call: CAPPluginCall) {
        let profile = call.getString("captureProfile", "object-relief")
        let facingMode = call.getString("facingMode", profile == "person-aura" ? "user" : currentFacingMode)
        let requestedRate = max(1, min(60, call.getInt("frameRate", 15)))
        targetFrameInterval = 1.0 / Double(requestedRate)

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            startCapture(profile: profile, facingMode: facingMode, call: call)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                guard let self else { return }
                if granted {
                    self.startCapture(profile: profile, facingMode: facingMode, call: call)
                } else {
                    DispatchQueue.main.async {
                        self.lastError = "Camera permission denied."
                        call.reject(self.lastError ?? "Camera permission denied.")
                    }
                }
            }
        default:
            lastError = "Camera permission denied."
            call.reject(lastError ?? "Camera permission denied.")
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        stopCapture(notify: true) { [weak self] status in
            guard self != nil else {
                call.resolve([
                    "active": false,
                    "captureProfile": "object-relief",
                    "facingMode": "environment"
                ])
                return
            }
            call.resolve(status)
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(statusObject())
    }

    deinit {
        stopCapture(notify: false)
    }

    private func startCapture(profile: String, facingMode: String, call: CAPPluginCall) {
        sessionQueue.async {
            do {
                try self.configureSession(profile: profile, facingMode: facingMode)
                self.captureSession?.startRunning()
                self.active = true
                self.currentProfile = profile
                self.currentFacingMode = facingMode
                self.lastError = nil
                let status = self.statusObject()
                DispatchQueue.main.async {
                    self.notifyListeners("status", data: status)
                    call.resolve(status)
                }
            } catch {
                self.active = false
                self.lastError = error.localizedDescription
                let status = self.statusObject()
                DispatchQueue.main.async {
                    self.notifyListeners("status", data: status)
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    private func configureSession(profile: String, facingMode: String) throws {
        stopCaptureOnQueue()

        let session = AVCaptureSession()
        session.beginConfiguration()
        session.sessionPreset = profile == "rgb-fast" ? .hd1280x720 : .hd1920x1080

        guard let device = preferredCamera(profile: profile, facingMode: facingMode) else {
            throw GhostVisionError.noCamera
        }

        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw GhostVisionError.cannotAddCamera
        }
        session.addInput(input)

        let nextVideoOutput = AVCaptureVideoDataOutput()
        nextVideoOutput.alwaysDiscardsLateVideoFrames = true
        nextVideoOutput.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
        ]
        nextVideoOutput.setSampleBufferDelegate(self, queue: sessionQueue)
        if session.canAddOutput(nextVideoOutput) {
            session.addOutput(nextVideoOutput)
        }

        let nextDepthOutput = AVCaptureDepthDataOutput()
        nextDepthOutput.isFilteringEnabled = true
        nextDepthOutput.setDelegate(self, callbackQueue: sessionQueue)
        if session.canAddOutput(nextDepthOutput) {
            session.addOutput(nextDepthOutput)
            if let connection = nextDepthOutput.connection(with: .depthData) {
                connection.isEnabled = true
            }
        }

        session.commitConfiguration()
        captureSession = session
        videoOutput = nextVideoOutput
        depthOutput = nextDepthOutput
        lastDepthInfo = nil
    }

    private func stopCapture(notify: Bool, completion: (([String: Any]) -> Void)? = nil) {
        sessionQueue.async {
            self.stopCaptureOnQueue()
            let status = self.statusObject()
            if notify {
                DispatchQueue.main.async {
                    self.notifyListeners("status", data: status)
                    completion?(status)
                }
            } else if let completion {
                DispatchQueue.main.async {
                    completion(status)
                }
            }
        }
    }

    private func stopCaptureOnQueue() {
        videoOutput?.setSampleBufferDelegate(nil, queue: nil)
        depthOutput?.setDelegate(nil, callbackQueue: nil)
        captureSession?.stopRunning()
        videoOutput = nil
        depthOutput = nil
        captureSession = nil
        active = false
        lastDepthInfo = nil
        lastDepthSample = nil
    }

    private func preferredCamera(profile: String, facingMode: String) -> AVCaptureDevice? {
        let position: AVCaptureDevice.Position
        if facingMode == "user" || profile == "person-aura" {
            position = .front
        } else {
            position = .back
        }

        if position == .front,
           let trueDepth = AVCaptureDevice.default(.builtInTrueDepthCamera, for: .video, position: .front) {
            return trueDepth
        }

        if position == .back {
            if #available(iOS 15.4, *),
               let lidarCamera = AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .video, position: .back) {
                return lidarCamera
            }
        }

        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .builtInDualCamera, .builtInDualWideCamera, .builtInTripleCamera],
            mediaType: .video,
            position: position
        )
        return discovery.devices.first ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
    }

    private func capabilitiesObject(profile: String, facingMode: String) -> [String: Any] {
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .builtInDualCamera, .builtInDualWideCamera, .builtInTripleCamera, .builtInTrueDepthCamera],
            mediaType: .video,
            position: .unspecified
        ).devices
        let hasCamera = !devices.isEmpty || AVCaptureDevice.default(for: .video) != nil
        let trueDepth = AVCaptureDevice.default(.builtInTrueDepthCamera, for: .video, position: .front) != nil
        let captureDepth = devices.contains { device in
            device.formats.contains { !$0.supportedDepthDataFormats.isEmpty }
        }

        var sceneDepth = false
        var personSegmentation = false
        #if canImport(ARKit)
        if ARWorldTrackingConfiguration.isSupported {
            if #available(iOS 14.0, *) {
                sceneDepth = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
            }
            personSegmentation = ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentationWithDepth)
                || ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentation)
        }
        #endif

        var visionSegmentation = false
        #if canImport(Vision)
        if #available(iOS 15.0, *) {
            visionSegmentation = VNGeneratePersonSegmentationRequest.supportedRevisions.count > 0
        }
        #endif

        let nativeDepth = captureDepth || sceneDepth || trueDepth
        return [
            "available": true,
            "platform": "ios",
            "facingMode": facingMode,
            "camera": hasCamera,
            "color": hasCamera,
            "depth": nativeDepth,
            "nativeDepth": nativeDepth,
            "lidar": sceneDepth,
            "trueDepth": trueDepth,
            "segmentation": visionSegmentation || personSegmentation,
            "personSegmentation": visionSegmentation || personSegmentation,
            "preferredWidth": profile == "rgb-fast" ? 1280 : 1920,
            "preferredHeight": profile == "rgb-fast" ? 720 : 1080,
            "preferredFrameRate": profile == "rgb-fast" ? 60 : 30,
            "notes": []
        ]
    }

    private func statusObject() -> [String: Any] {
        var status: [String: Any] = [
            "active": active,
            "captureProfile": currentProfile,
            "facingMode": currentFacingMode,
            "capabilities": capabilitiesObject(profile: currentProfile, facingMode: currentFacingMode)
        ]
        if let lastError {
            status["error"] = lastError
        }
        return status
    }

    public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard active else { return }
        let now = CFAbsoluteTimeGetCurrent()
        guard now - lastEmitTime >= targetFrameInterval else { return }
        lastEmitTime = now
        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        var payload: [String: Any] = [
            "timestamp": Int64(now * 1000),
            "width": CVPixelBufferGetWidth(imageBuffer),
            "height": CVPixelBufferGetHeight(imageBuffer),
            "captureProfile": currentProfile,
            "depth": lastDepthInfo != nil
        ]
        if let lastDepthInfo {
            payload["depthWidth"] = lastDepthInfo["width"]
            payload["depthHeight"] = lastDepthInfo["height"]
        }
        if let lastDepthSample {
            payload["depthSample"] = lastDepthSample
        }
        if currentProfile == "person-aura",
           let maskSample = makePersonMaskSample(sampleBuffer: sampleBuffer, timestampMs: Int64(now * 1000)) {
            payload["maskSample"] = maskSample
        }

        DispatchQueue.main.async {
            self.notifyListeners("frame", data: payload)
        }
    }

    public func depthDataOutput(_ output: AVCaptureDepthDataOutput, didOutput depthData: AVDepthData, timestamp: CMTime, connection: AVCaptureConnection) {
        let converted = depthData.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
        let map = converted.depthDataMap
        let timestampMs = Int64(CMTimeGetSeconds(timestamp) * 1000)
        lastDepthInfo = [
            "width": CVPixelBufferGetWidth(map),
            "height": CVPixelBufferGetHeight(map),
            "timestamp": timestampMs
        ]
        lastDepthSample = makeDepthSample(from: map, timestampMs: timestampMs)
    }

    private func makeDepthSample(from pixelBuffer: CVPixelBuffer, timestampMs: Int64) -> [String: Any]? {
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }

        let srcW = CVPixelBufferGetWidth(pixelBuffer)
        let srcH = CVPixelBufferGetHeight(pixelBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        guard srcW > 0, srcH > 0 else { return nil }

        var values = [Float](repeating: 0, count: sampleWidth * sampleHeight)
        var minDepth = Float.greatestFiniteMagnitude
        var maxDepth: Float = 0
        for y in 0..<sampleHeight {
            let sy = min(srcH - 1, (y * srcH) / sampleHeight)
            let row = base.advanced(by: sy * bytesPerRow).assumingMemoryBound(to: Float32.self)
            for x in 0..<sampleWidth {
                let sx = min(srcW - 1, (x * srcW) / sampleWidth)
                let v = row[sx]
                let valid = v.isFinite && v > 0
                let depth = valid ? v : 0
                values[y * sampleWidth + x] = depth
                if valid {
                    minDepth = min(minDepth, depth)
                    maxDepth = max(maxDepth, depth)
                }
            }
        }
        guard minDepth.isFinite, maxDepth > minDepth else { return nil }

        let scale = 255.0 / max(0.001, maxDepth - minDepth)
        var bytes = [UInt8](repeating: 0, count: sampleWidth * sampleHeight)
        for i in 0..<values.count {
            let depth = values[i]
            if depth > 0 {
                bytes[i] = UInt8(max(0, min(255, Int((depth - minDepth) * scale))))
            }
        }
        return [
            "kind": "depth",
            "format": "r8-depth-normalized",
            "width": sampleWidth,
            "height": sampleHeight,
            "timestamp": timestampMs,
            "minDepth": minDepth,
            "maxDepth": maxDepth,
            "data": Data(bytes).base64EncodedString()
        ]
    }

    private func makePersonMaskSample(sampleBuffer: CMSampleBuffer, timestampMs: Int64) -> [String: Any]? {
        #if canImport(Vision)
        guard #available(iOS 15.0, *) else { return nil }
        let request = VNGeneratePersonSegmentationRequest()
        request.qualityLevel = .fast
        request.outputPixelFormat = kCVPixelFormatType_OneComponent8
        let handler = VNImageRequestHandler(cmSampleBuffer: sampleBuffer, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return nil
        }
        guard let mask = request.results?.first?.pixelBuffer else { return nil }
        return makeUInt8Sample(from: mask, kind: "person-mask", format: "r8-mask", timestampMs: timestampMs)
        #else
        return nil
        #endif
    }

    private func makeUInt8Sample(from pixelBuffer: CVPixelBuffer, kind: String, format: String, timestampMs: Int64) -> [String: Any]? {
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }

        let srcW = CVPixelBufferGetWidth(pixelBuffer)
        let srcH = CVPixelBufferGetHeight(pixelBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        guard srcW > 0, srcH > 0 else { return nil }

        var bytes = [UInt8](repeating: 0, count: sampleWidth * sampleHeight)
        for y in 0..<sampleHeight {
            let sy = min(srcH - 1, (y * srcH) / sampleHeight)
            let row = base.advanced(by: sy * bytesPerRow).assumingMemoryBound(to: UInt8.self)
            for x in 0..<sampleWidth {
                let sx = min(srcW - 1, (x * srcW) / sampleWidth)
                bytes[y * sampleWidth + x] = row[sx]
            }
        }
        return [
            "kind": kind,
            "format": format,
            "width": sampleWidth,
            "height": sampleHeight,
            "timestamp": timestampMs,
            "data": Data(bytes).base64EncodedString()
        ]
    }
}

enum GhostVisionError: LocalizedError {
    case noCamera
    case cannotAddCamera

    var errorDescription: String? {
        switch self {
        case .noCamera:
            return "No compatible camera was found."
        case .cannotAddCamera:
            return "Could not add camera input."
        }
    }
}
