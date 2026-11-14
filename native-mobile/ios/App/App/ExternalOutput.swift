import UIKit
import WebKit
import Capacitor

// The phone and projector have separate windows. Never put app controls in the external scene.
final class StudioSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        if window == nil {
            let window = UIWindow(windowScene: scene)
            window.rootViewController = UIStoryboard(name: "Main", bundle: nil).instantiateInitialViewController()
            self.window = window
            window.makeKeyAndVisible()
        }
        // A link that launched the app arrives here, not through openURLContexts.
        open(connectionOptions.urlContexts)
    }
    func sceneDidBecomeActive(_ scene: UIScene) {
        // A live set must never dim or lock while the app is on screen, with or without a second display.
        UIApplication.shared.isIdleTimerDisabled = true
        StudioExternalOutput.shared.publishConnection()
        if let scene = scene as? UIWindowScene { StudioLiveCapture.shared.interfaceOrientationChanged(scene.interfaceOrientation) }
    }
    // Camera frames follow the phone UI as it rotates.
    func windowScene(_ windowScene: UIWindowScene, didUpdate previousCoordinateSpace: UICoordinateSpace, interfaceOrientation previousInterfaceOrientation: UIInterfaceOrientation, traitCollection previousTraitCollection: UITraitCollection) {
        StudioLiveCapture.shared.interfaceOrientationChanged(windowScene.interfaceOrientation)
    }
    func sceneDidEnterBackground(_ scene: UIScene) { UIApplication.shared.isIdleTimerDisabled = false }
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) { open(URLContexts) }
    private func open(_ contexts: Set<UIOpenURLContext>) {
        for context in contexts where !PairingLinkInbox.receive(context.url) {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
    }
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}

final class OutputSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        let controller = UIViewController()
        controller.view.backgroundColor = .black
        window.rootViewController = controller
        window.backgroundColor = .black
        self.window = window
        // Do not steal the phone's key window or keyboard focus.
        window.isHidden = false
        StudioExternalOutput.shared.connect(window)
    }
    func sceneDidDisconnect(_ scene: UIScene) {
        if let window = window { StudioExternalOutput.shared.disconnect(window) }
        window = nil
    }
}

final class StudioBridgeViewController: CAPBridgeViewController {
    // Capacitor only reads the iPhone orientation list, so iPad is answered here: every orientation.
    // iPhone stays in portrait except while the Map workspace allows landscape.
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { UIDevice.current.userInterfaceIdiom == .pad ? .all : StudioOrientation.phoneMask }

    private var outputDelegate: OutputUIDelegate?
    private var pairingObserver: NSObjectProtocol?
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.setURLSchemeHandler(StudioCaptureScheme(), forURLScheme: "ghostcapture")
        return config
    }
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(StudioCapturePlugin())
        bridge?.registerPluginInstance(StudioOutputPlugin())
        guard let webView = webView else { return }
        let delegate = OutputUIDelegate(fallback: webView.uiDelegate)
        outputDelegate = delegate
        webView.uiDelegate = delegate
        StudioExternalOutput.shared.attachController(webView)
        // The event carries no link. The web layer collects it with StudioCapture.takePairingLink, exactly once.
        pairingObserver = NotificationCenter.default.addObserver(forName: PairingLinkInbox.arrived, object: nil, queue: .main) { [weak self] _ in
            self?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('ghost-pairing-link'));", completionHandler: nil)
        }
    }
    deinit { if let pairingObserver = pairingObserver { NotificationCenter.default.removeObserver(pairingObserver) } }
}

// Forward Capacitor's permission dialogs/file pickers rather than replacing their behavior.
final class OutputUIDelegate: NSObject, WKUIDelegate {
    let fallback: WKUIDelegate?
    init(fallback: WKUIDelegate?) { self.fallback = fallback; super.init() }
    override func responds(to selector: Selector!) -> Bool { super.responds(to: selector) || (fallback?.responds(to: selector) ?? false) }
    override func forwardingTarget(for selector: Selector!) -> Any? {
        if fallback?.responds(to: selector) == true { return fallback }
        return super.forwardingTarget(for: selector)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.request.url?.absoluteString == "about:blank", StudioExternalOutput.shared.isController(webView) {
            return StudioExternalOutput.shared.makeOutput(configuration)
        }
        return fallback?.webView?(webView, createWebViewWith: configuration, for: navigationAction, windowFeatures: windowFeatures)
    }
    func webViewDidClose(_ webView: WKWebView) { StudioExternalOutput.shared.closeOutput(webView) }
}

final class StudioExternalOutput: NSObject, WKScriptMessageHandler {
    static let shared = StudioExternalOutput()
    private weak var controller: WKWebView?
    private var window: UIWindow?
    private var output: WKWebView?
    private var revision = 0
    /// Use every pixel of the display (no TV overscan margin). Mapping needs the corners of the real raster.
    private var fullFrame = true
    /// A display mode the person chose, or nil for the display's own preferred mode.
    private var chosenSize: CGSize?
    func isController(_ webView: WKWebView) -> Bool { controller === webView }
    func attachController(_ webView: WKWebView) {
        controller = webView
        webView.configuration.userContentController.add(self, name: "ghostOutput")
    }
    func connect(_ window: UIWindow) {
        closeOutputView()
        self.window = window
        revision += 1
        applyDisplay()
        publishConnection()
    }
    /// Edge margin and display mode, applied whenever a display connects or the choice changes.
    private func applyDisplay() {
        guard let screen = window?.windowScene?.screen else { return }
        screen.overscanCompensation = fullFrame ? .none : .scale
        let wanted = chosenSize.flatMap { size in screen.availableModes.first { $0.size == size } } ?? screen.preferredMode
        if let wanted = wanted, screen.currentMode != wanted { screen.currentMode = wanted }
        if let window = window, let scene = window.windowScene { window.frame = scene.coordinateSpace.bounds }
    }
    func disconnect(_ window: UIWindow) {
        guard self.window === window else { return }
        closeOutputView()
        self.window = nil
        publishConnection()
    }
    func publishConnection() {
        var detail: [String: Any] = ["connected": window != nil, "revision": revision]
        if let screen = window?.windowScene?.screen {
            let size = screen.currentMode?.size ?? screen.bounds.size
            detail["display"] = ["name": "External display", "width": Int(size.width), "height": Int(size.height)]
            var seen = Set<String>()
            detail["modes"] = screen.availableModes.compactMap { mode -> [String: Int]? in
                let key = "\(Int(mode.size.width))x\(Int(mode.size.height))"
                guard mode.size.width > 0, mode.size.height > 0, seen.insert(key).inserted else { return nil }
                return ["width": Int(mode.size.width), "height": Int(mode.size.height)]
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: detail), let json = String(data: data, encoding: .utf8) else { return }
        controller?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('ghost-external-display',{detail:\(json)}));", completionHandler: nil)
    }
    func makeOutput(_ configuration: WKWebViewConfiguration) -> WKWebView? {
        guard let host = window?.rootViewController?.view else { return nil }
        closeOutputView()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsAirPlayForMediaPlayback = false
        // Use WebKit's supplied popup configuration to preserve the same-origin opener.
        // This lets the output video consume the composition MediaStream directly, without
        // JPEG frames, JS/native pixel copies, another renderer or another camera capture.
        let view = WKWebView(frame: host.bounds, configuration: configuration)
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.isOpaque = true
        view.backgroundColor = .black
        view.scrollView.backgroundColor = .black
        // The display's own edge insets must not push the picture down: the video covers the whole raster.
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.isScrollEnabled = false
        view.isUserInteractionEnabled = false
        view.uiDelegate = controller?.uiDelegate
        host.addSubview(view)
        output = view
        return view
    }
    func closeOutput(_ view: WKWebView) { if output === view { closeOutputView() } }
    private func closeOutputView() { output?.stopLoading(); output?.removeFromSuperview(); output = nil }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.webView === controller, let data = message.body as? [String: Any] else { return }
        if data["type"] as? String == "ready" { publishConnection() }
        if data["type"] as? String == "status" { NSLog("[GhostOutput] %@", data["state"] as? String ?? "unknown") }
        if data["type"] as? String == "display" {
            fullFrame = data["fullFrame"] as? Bool ?? true
            let width = (data["width"] as? NSNumber)?.doubleValue ?? 0, height = (data["height"] as? NSNumber)?.doubleValue ?? 0
            chosenSize = width > 0 && height > 0 ? CGSize(width: width, height: height) : nil
            guard window != nil else { return }
            applyDisplay()
            publishConnection()
        }
    }
}
