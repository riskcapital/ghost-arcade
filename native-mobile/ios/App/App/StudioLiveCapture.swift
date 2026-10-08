import Foundation
import UIKit
import ARKit
import AVFoundation
import WebKit
import Accelerate
import CoreImage

/// Camera frames are pulled as bounded binary planes, never JPEG/base64 or per-frame JS events.
final class StudioLiveCapture: NSObject, ARSessionDelegate, AVCaptureVideoDataOutputSampleBufferDelegate {
    static let shared = StudioLiveCapture()
    private let queue = DispatchQueue(label: "live.ghostarcade.deck.capture", qos: .userInitiated)
    private var camera: AVCaptureSession?
    private var ar: ARSession?
    private var calibrationFrame: ARFrame?
    private var buffers: [String: CVPixelBuffer] = [:]
    private var depth: CVPixelBuffer?, confidence: CVPixelBuffer?
    private var outputs: [AVCaptureVideoDataOutput: String] = [:]
    private var sequence: UInt32 = 0
    private var intrinsics = SIMD4<Float>(1, 1, 0.5, 0.5)
    private var mode = ""
    private var activeSources: [String] = []
    private var suspended = false
    private var failure: String?
    override init() {
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(foreground), name: UIApplication.willEnterForegroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(captureResumed), name: AVCaptureSession.interruptionEndedNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(interruption), name: AVCaptureSession.wasInterruptedNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(interruption), name: AVCaptureSession.runtimeErrorNotification, object: nil)
    }
    func configure(_ sources: [String], completion: @escaping (Error?) -> Void) {
        queue.async {
            guard sources.allSatisfy({ ["rear", "front", "depth"].contains($0) }) else { completion(self.error("Unknown camera source.")); return }
            guard !(sources.contains("depth") && sources.contains("front")) else { completion(self.error("Stop the depth clip before using the front camera.")); return }
            let previous = self.activeSources
            do {
                let next = sources.isEmpty ? "" : sources.contains("depth") ? "depth" : sources.sorted().joined(separator: "+")
                if next != self.mode || self.failure != nil {
                    self.stop(); self.failure = nil
                    if next == "depth" { try self.startDepth() }
                    if next != "depth" && !next.isEmpty { try self.startCameras(sources) }
                    self.mode = next
                }
                self.activeSources = sources
                completion(nil)
            } catch {
                self.stop()
                // Failed additions must not kill an already-playing camera source.
                do { if previous.contains("depth") { try self.startDepth(); self.mode = "depth" } else if !previous.isEmpty { try self.startCameras(previous); self.mode = previous.sorted().joined(separator: "+") }; self.activeSources = previous } catch { self.failure = error.localizedDescription }
                completion(error)
            }
        }
    }
    private func error(_ s: String) -> NSError { NSError(domain: "GhostLiveCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: s]) }
    private func stop() {
        ar?.pause(); ar?.delegate = nil; ar = nil
        camera?.stopRunning(); outputs.keys.forEach { $0.setSampleBufferDelegate(nil, queue: nil) }; camera = nil
        outputs.removeAll(); buffers.removeAll(); depth = nil; confidence = nil; calibrationFrame = nil; mode = ""
    }
    private func startDepth() throws {
        guard ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) else { throw error("This device does not have LiDAR scene depth.") }
        let session = ARSession(); session.delegate = self; session.delegateQueue = queue; ar = session
        let config = ARWorldTrackingConfiguration(); config.frameSemantics = .sceneDepth
        // Let ARKit select a scene-depth-compatible format.
        if !suspended { session.run(config) }
    }
    private func startCameras(_ sources: [String]) throws {
        let dual = sources.contains("rear") && sources.contains("front")
        guard !dual || AVCaptureMultiCamSession.isMultiCamSupported else { throw error("Simultaneous front/rear capture is unavailable on this device.") }
        let session: AVCaptureSession = dual ? AVCaptureMultiCamSession() : AVCaptureSession(); camera = session; session.beginConfiguration()
        if session.canSetSessionPreset(.inputPriority) { session.sessionPreset = .inputPriority }
        var committed = false
        defer { if !committed { session.commitConfiguration() } }
        for position: AVCaptureDevice.Position in [.back, .front] where sources.contains(position == .back ? "rear" : "front") {
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position) else { throw error("Camera unavailable.") }
            let candidates = device.formats.filter { f in let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription); return (!dual || f.isMultiCamSupported) && d.width >= 640 && d.width <= 1280 && d.height <= 720 && f.videoSupportedFrameRateRanges.contains { $0.minFrameRate <= 24 && $0.maxFrameRate >= 24 } }
            guard let format = candidates.min(by: { CMVideoFormatDescriptionGetDimensions($0.formatDescription).width < CMVideoFormatDescriptionGetDimensions($1.formatDescription).width }) else { throw error("No compatible dual-camera format.") }
            try device.lockForConfiguration(); device.activeFormat = format; device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 24); device.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 24); device.unlockForConfiguration()
            let input = try AVCaptureDeviceInput(device: device)
            guard session.canAddInput(input) else { throw error("Cannot connect camera.") }; session.addInputWithNoConnections(input)
            guard let port = input.ports(for: .video, sourceDeviceType: .builtInWideAngleCamera, sourceDevicePosition: position).first else { throw error("Camera port unavailable.") }
            let output = AVCaptureVideoDataOutput(); output.alwaysDiscardsLateVideoFrames = true; output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]; output.setSampleBufferDelegate(self, queue: queue)
            guard session.canAddOutput(output) else { throw error("Cannot capture both cameras.") }; session.addOutputWithNoConnections(output)
            let connection = AVCaptureConnection(inputPorts: [port], output: output)
            guard session.canAddConnection(connection) else { throw error("Cannot connect camera stream.") }; session.addConnection(connection)
            if connection.isVideoOrientationSupported { connection.videoOrientation = UIDevice.current.userInterfaceIdiom == .pad ? .landscapeRight : .portrait }
            if connection.isVideoMirroringSupported { connection.automaticallyAdjustsVideoMirroring = false; connection.isVideoMirrored = false }
            outputs[output] = position == .back ? "rear" : "front"
        }
        session.commitConfiguration(); committed = true
        if let multi = session as? AVCaptureMultiCamSession, multi.hardwareCost > 1 { throw error("Dual cameras exceed this device’s capture budget.") }
        if !suspended { session.startRunning() }
    }
    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard session === ar else { return }; failure = nil; calibrationFrame = frame
        let i = frame.camera.intrinsics, r = frame.camera.imageResolution
        intrinsics = SIMD4(i[0,0] / Float(r.width), i[1,1] / Float(r.height), i[2,0] / Float(r.width), i[2,1] / Float(r.height))
        buffers["rear"] = frame.capturedImage; depth = frame.sceneDepth?.depthMap; confidence = frame.sceneDepth?.confidenceMap; sequence &+= 1
    }
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let out = output as? AVCaptureVideoDataOutput, let name = outputs[out], let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }; failure = nil; buffers[name] = buffer; sequence &+= 1
    }
    func session(_ session: ARSession, didFailWithError error: Error) { guard session === ar else { return }; failure = error.localizedDescription; buffers.removeAll(); depth = nil; calibrationFrame = nil }
    func sessionWasInterrupted(_ session: ARSession) { guard session === ar else { return }; buffers.removeAll(); depth = nil; calibrationFrame = nil }
    func sessionInterruptionEnded(_ session: ARSession) {
        guard session === ar, !suspended else { return }
        failure = nil
        let config = ARWorldTrackingConfiguration(); config.frameSemantics = .sceneDepth
        session.run(config, options: [.resetTracking])
    }
    @objc private func captureResumed(_ notification: Notification) {
        queue.async { if let source = notification.object as? AVCaptureSession, source === self.camera, !self.suspended { self.failure = nil; source.startRunning() } }
    }
    @objc private func interruption(_ notification: Notification) { queue.async { if let source = notification.object as? AVCaptureSession, source === self.camera { self.buffers.removeAll(); self.failure = "Camera interrupted. Stop and relaunch the camera clip." } } }
    @objc private func background() { queue.async { self.suspended = true; self.camera?.stopRunning(); self.ar?.pause(); self.buffers.removeAll(); self.depth = nil; self.calibrationFrame = nil } }
    @objc private func foreground() { queue.async { self.suspended = false; self.failure = nil; self.camera?.startRunning(); if let ar = self.ar { let c = ARWorldTrackingConfiguration(); c.frameSemantics = .sceneDepth; ar.run(c) } } }

    func frame(_ source: String, completion: @escaping (Data?, String?) -> Void) {
        queue.async {
            if let failure = self.failure { completion(nil, failure); return }
            guard !self.suspended else { completion(nil, nil); return }
            if source == "depth" {
                guard let d = self.depth, let c = self.confidence else { completion(nil, nil); return }
                CVPixelBufferLockBaseAddress(d, .readOnly); CVPixelBufferLockBaseAddress(c, .readOnly)
                defer { CVPixelBufferUnlockBaseAddress(d, .readOnly); CVPixelBufferUnlockBaseAddress(c, .readOnly) }
                guard let dp = CVPixelBufferGetBaseAddress(d)?.assumingMemoryBound(to: Float.self), let cp = CVPixelBufferGetBaseAddress(c)?.assumingMemoryBound(to: UInt8.self) else { completion(nil, nil); return }
                let w = CVPixelBufferGetWidth(d), h = CVPixelBufferGetHeight(d), stride = CVPixelBufferGetBytesPerRow(d) / 4, cs = CVPixelBufferGetBytesPerRow(c)
                var data = self.header(type: 1, width: w, height: h, flags: UIDevice.current.userInterfaceIdiom == .pad ? 8 : 0)
                for y in 0..<h { for x in 0..<w { let value = dp[y * stride + x]; var mm: UInt16 = (value.isFinite && value > 0 && value < 12 && cp[y * cs + x] >= 1) ? UInt16(value * 1000) : 0; mm = mm.littleEndian; withUnsafeBytes(of: &mm) { data.append(contentsOf: $0) } } }
                completion(data, nil); return
            }
            guard let image = self.buffers[source], CVPixelBufferGetPlaneCount(image) == 2 else { completion(nil, nil); return }
            CVPixelBufferLockBaseAddress(image, .readOnly); defer { CVPixelBufferUnlockBaseAddress(image, .readOnly) }
            let iw = CVPixelBufferGetWidth(image), ih = CVPixelBufferGetHeight(image)
            let scale = min(1.0, 640.0 / Double(max(iw, ih)))
            let w = max(2, Int(Double(iw) * scale) / 2 * 2), h = max(2, Int(Double(ih) * scale) / 2 * 2)
            let matrix = CVBufferCopyAttachment(image, kCVImageBufferYCbCrMatrixKey, nil) as? String
            let flags: UInt32 = (matrix == (kCVImageBufferYCbCrMatrix_ITU_R_709_2 as String) ? 1 : 0) | (CVPixelBufferGetPixelFormatType(image) == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange ? 2 : 0)
            var data = self.header(type: 0, width: w, height: h, flags: flags | (self.ar != nil && UIDevice.current.userInterfaceIdiom != .pad ? 4 : 0))
            for plane in 0...1 {
                guard let base = CVPixelBufferGetBaseAddressOfPlane(image, plane) else { completion(nil, nil); return }
                let pw = plane == 0 ? w : w / 2, ph = plane == 0 ? h : h / 2
                var result = Data(count: w * ph)
                let status = result.withUnsafeMutableBytes { ptr -> vImage_Error in
                    var src = vImage_Buffer(data: base, height: vImagePixelCount(CVPixelBufferGetHeightOfPlane(image, plane)), width: vImagePixelCount(CVPixelBufferGetWidthOfPlane(image, plane)), rowBytes: CVPixelBufferGetBytesPerRowOfPlane(image, plane))
                    var dst = vImage_Buffer(data: ptr.baseAddress!, height: vImagePixelCount(ph), width: vImagePixelCount(pw), rowBytes: w)
                    return plane == 0 ? vImageScale_Planar8(&src, &dst, nil, vImage_Flags(kvImageNoFlags)) : vImageScale_CbCr8(&src, &dst, nil, vImage_Flags(kvImageNoFlags))
                }
                guard status == kvImageNoError else { completion(nil, "Camera resize failed."); return }; data.append(result)
            }
            completion(data, nil)
        }
    }
    // One coherent sensor-space reference, captured only on explicit request. Never mixes live frames.
    func calibrationReference(completion: @escaping ([String: Any]?, String?) -> Void) {
        queue.async {
            guard !self.suspended, self.failure == nil, let frame = self.calibrationFrame,
                  ProcessInfo.processInfo.systemUptime - frame.timestamp < 1,
                  let scene = frame.sceneDepth, let confidence = scene.confidenceMap else {
                completion(nil, "No fresh LiDAR reference. Keep the camera still and try again."); return
            }
            guard case .normal = frame.camera.trackingState else {
                completion(nil, "Move slowly until AR tracking is stable, then capture again."); return
            }
            let image = CIImage(cvPixelBuffer: frame.capturedImage)
            let context = CIContext()
            guard let cg = context.createCGImage(image, from: image.extent),
                  let jpeg = UIImage(cgImage: cg).jpegData(compressionQuality: 0.85) else {
                completion(nil, "Could not capture the reference photo."); return
            }
            let depth = scene.depthMap, w = CVPixelBufferGetWidth(depth), h = CVPixelBufferGetHeight(depth)
            CVPixelBufferLockBaseAddress(depth, .readOnly); CVPixelBufferLockBaseAddress(confidence, .readOnly)
            defer { CVPixelBufferUnlockBaseAddress(depth, .readOnly); CVPixelBufferUnlockBaseAddress(confidence, .readOnly) }
            guard let dp = CVPixelBufferGetBaseAddress(depth)?.assumingMemoryBound(to: Float.self),
                  let cp = CVPixelBufferGetBaseAddress(confidence)?.assumingMemoryBound(to: UInt8.self) else {
                completion(nil, "Depth data unavailable."); return
            }
            let ds = CVPixelBufferGetBytesPerRow(depth) / 4, cs = CVPixelBufferGetBytesPerRow(confidence)
            var distances = Data(), confidences = Data()
            for y in 0..<h { for x in 0..<w {
                let z = dp[y * ds + x], confidence = cp[y * cs + x]
                var mm: UInt16 = (z.isFinite && z > 0 && z < 12 && confidence >= 1) ? UInt16(z * 1000) : 0
                mm = mm.littleEndian
                withUnsafeBytes(of: &mm) { distances.append(contentsOf: $0) }; confidences.append(confidence)
            } }
            let k = frame.camera.intrinsics, size = frame.camera.imageResolution, pose = frame.camera.transform
            let matrix = (0..<4).flatMap { column in (0..<4).map { row in Double(pose[column][row]) } }
            completion(["image": "data:image/jpeg;base64," + jpeg.base64EncodedString(), "width": cg.width, "height": cg.height,
                        "depth": ["width": w, "height": h, "millimeters": distances.base64EncodedString(),
                                  "confidence": confidences.base64EncodedString(), "timestamp": frame.timestamp,
                                  "intrinsics": [Double(k[0,0]) / size.width, Double(k[1,1]) / size.height, Double(k[2,0]) / size.width, Double(k[2,1]) / size.height],
                                  "cameraToWorld": matrix]], nil)
        }
    }
    private func header(type: UInt32, width: Int, height: Int, flags: UInt32) -> Data {
        var data = Data()
        for value in [UInt32(0x47414331), type, sequence, UInt32(width), UInt32(height), flags] { var v = value.littleEndian; withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }
        for value in [intrinsics.x, intrinsics.y, intrinsics.z, intrinsics.w, 0, 0] { var v = value.bitPattern.littleEndian; withUnsafeBytes(of: &v) { data.append(contentsOf: $0) } }
        return data
    }
}

final class StudioCaptureScheme: NSObject, WKURLSchemeHandler {
    private var tasks = Set<ObjectIdentifier>() // WK callbacks and completions serialized on main
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let id = ObjectIdentifier(urlSchemeTask); tasks.insert(id)
        let source = urlSchemeTask.request.url?.lastPathComponent ?? ""
        guard ["front", "rear", "depth"].contains(source) else { finish(urlSchemeTask, id: id, data: nil, error: "Unknown source"); return }
        StudioLiveCapture.shared.frame(source) { data, error in DispatchQueue.main.async { self.finish(urlSchemeTask, id: id, data: data, error: error) } }
    }
    private func finish(_ task: WKURLSchemeTask, id: ObjectIdentifier, data: Data?, error: String?) {
        guard tasks.remove(id) != nil, let url = task.request.url else { return }
        let body = data ?? Data((error ?? "").utf8)
        let response = HTTPURLResponse(url: url, statusCode: error != nil ? 409 : data == nil ? 204 : 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/octet-stream", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store", "Content-Length": "\(body.count)"])!
        task.didReceive(response); task.didReceive(body); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) { tasks.remove(ObjectIdentifier(urlSchemeTask)) }
}
