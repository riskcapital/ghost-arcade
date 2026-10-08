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
    func sceneDidBecomeActive(_ scene: UIScene) { StudioExternalOutput.shared.publishConnection() }
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
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { UIDevice.current.userInterfaceIdiom == .pad ? .landscapeRight : super.supportedInterfaceOrientations }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { UIDevice.current.userInterfaceIdiom == .pad ? .landscapeRight : super.preferredInterfaceOrientationForPresentation }
    override var shouldAutorotate: Bool { UIDevice.current.userInterfaceIdiom != .pad }

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
    private var wasIdleDisabled = false
    private var revision = 0
    func isController(_ webView: WKWebView) -> Bool { controller === webView }
    func attachController(_ webView: WKWebView) {
        controller = webView
        webView.configuration.userContentController.add(self, name: "ghostOutput")
    }
    func connect(_ window: UIWindow) {
        if self.window == nil { wasIdleDisabled = UIApplication.shared.isIdleTimerDisabled }
        closeOutputView()
        self.window = window
        revision += 1
        UIApplication.shared.isIdleTimerDisabled = true
        publishConnection()
    }
    func disconnect(_ window: UIWindow) {
        guard self.window === window else { return }
        closeOutputView()
        self.window = nil
        UIApplication.shared.isIdleTimerDisabled = wasIdleDisabled
        publishConnection()
    }
    func publishConnection() {
        var detail: [String: Any] = ["connected": window != nil, "revision": revision]
        if let screen = window?.windowScene?.screen {
            let size = screen.currentMode?.size ?? screen.bounds.size
            detail["display"] = ["name": "External display", "width": Int(size.width), "height": Int(size.height)]
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
    }
}
