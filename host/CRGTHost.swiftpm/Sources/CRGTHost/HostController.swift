// CRGT in a web view, with the iPad's MIDI handed to it as Web MIDI (bridge.js, injected before CRGT's own scripts).
// The page runs at https://tazzinaz.github.io/crgt/ (its sessions and samples are kept for that address), from the
// copy the app keeps (PageStore), so it opens with no connection. Files CRGT saves go to the share sheet.

import UIKit
import WebKit
import CoreAudioKit
import CoreMIDI
import AVFoundation

enum HostInfo {
    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0" }
    static var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1" }
}

enum AudioSetup {
    /// Plays with the silent switch on, alongside other apps, with short buffers.
    static func activate() {
        let s = AVAudioSession.sharedInstance()
        do {
            try s.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try? s.setPreferredIOBufferDuration(0.005)
            try s.setActive(true)
        } catch {
            print("CRGT Host: audio session: \(error)")
        }
    }
}

/// Keeps the web view from holding on to the controller through its message handler.
final class ReplyProxy: NSObject, WKScriptMessageHandlerWithReply {
    weak var owner: HostController?
    init(_ owner: HostController) { self.owner = owner }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let owner else { replyHandler(nil, "CRGT Host is not running"); return }
        owner.handle(message, reply: replyHandler)
    }
}

final class HostController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    static let site = URL(string: "https://tazzinaz.github.io/crgt/")!
    static let pageFile = URL(string: "https://tazzinaz.github.io/crgt/index.html")!
    static let siteHost = "tazzinaz.github.io"
    static let ground = UIColor(red: 0x27 / 255.0, green: 0x27 / 255.0, blue: 0x2A / 255.0, alpha: 1)

    private var web: WKWebView!
    private let midi = MIDIHub()
    private let store = PageStore()
    private var shown: CRGTPage?
    private var ownLoad = false
    private var lastCheck = Date.distantPast
    private var checking = false
    private var newer: CRGTPage?
    private var exports: [ObjectIdentifier: URL] = [:]
    private var observers: [NSObjectProtocol] = []

    // MARK: setup

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.applicationNameForUserAgent = "CRGTHost/\(HostInfo.version)"
        cfg.websiteDataStore = .default()
        let info = Self.json(["version": HostInfo.version, "build": HostInfo.build])
        let ucc = cfg.userContentController
        ucc.addUserScript(WKUserScript(source: BridgeScript.source(info: info), injectionTime: .atDocumentStart,
                                       forMainFrameOnly: true, in: .page))
        ucc.addScriptMessageHandler(ReplyProxy(self), contentWorld: .page, name: "crgtHost")

        let w = WKWebView(frame: .zero, configuration: cfg)
        w.navigationDelegate = self
        w.uiDelegate = self
        w.isOpaque = false
        w.backgroundColor = Self.ground
        w.underPageBackgroundColor = Self.ground
        w.scrollView.backgroundColor = Self.ground
        w.scrollView.bounces = false
        w.scrollView.contentInsetAdjustmentBehavior = .never
        w.allowsLinkPreview = false
        w.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { w.isInspectable = true }   // Safari on a Mac: Develop > iPad > CRGT
        web = w
        view = w
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        midi.onReceive = { [weak self] json in self?.js("__crgtHost.rx(\(json))") }
        midi.onChange = { [weak self] in self?.pushStatus() }
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.becameActive()
        })
        observers.append(nc.addObserver(forName: NSNotification.Name(MIDINetworkNotificationSessionDidChange), object: nil, queue: .main) { [weak self] _ in
            self?.pushStatus()
        })
        midi.restoreNetwork()
        loadBest()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        UIApplication.shared.isIdleTimerDisabled = true
    }

    private func becameActive() {
        UIApplication.shared.isIdleTimerDisabled = true
        AudioSetup.activate()
        midi.refresh()
        checkForUpdate(force: false)
    }

    // MARK: the page

    /// Opens the newest CRGT kept on the iPad, as if it came from tazzinaz.github.io/crgt/.
    private func loadBest() {
        ownLoad = true
        if let page = store.best() {
            shown = page
            _ = web.loadSimulatedRequest(URLRequest(url: Self.site), responseHTML: page.html)
        } else {
            shown = nil
            web.load(URLRequest(url: Self.site, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 20))
        }
    }

    private func showOffline() {
        let html = """
        <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#27272A;color:#ECEAE6;
        font:17px/1.5 -apple-system,system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
        h1{font-size:22px;font-weight:600;margin:0 0 8px}p{margin:0 0 20px;max-width:30em;color:#B9B6B0}
        button{font:600 15px -apple-system,system-ui;letter-spacing:.06em;padding:12px 22px;border-radius:10px;border:0;
        background:#D18365;color:#1E1E21}</style></head><body><div>
        <h1>CRGT is not on this iPad yet</h1>
        <p>Connect to the internet once: CRGT Host downloads CRGT and keeps it, so from then on it opens with no connection.</p>
        <button onclick="webkit.messageHandlers.crgtHost.postMessage({op:'retry'})">TRY AGAIN</button></div></body></html>
        """
        ownLoad = true
        web.loadHTMLString(html, baseURL: Self.site)
    }

    /// Looks for a newer CRGT on GitHub Pages (at most every 15 minutes unless forced) and keeps it.
    private func checkForUpdate(force: Bool) {
        if checking || (!force && Date().timeIntervalSince(lastCheck) < 15 * 60) { return }
        checking = true
        lastCheck = Date()
        let req = URLRequest(url: Self.pageFile, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        URLSession.shared.dataTask(with: req) { [weak self] data, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async {
                guard let self else { return }
                self.checking = false
                if ok, let data { self.gotRemote(data) }
            }
        }.resume()
    }

    private func gotRemote(_ data: Data) {
        guard let page = store.keep(data) else { return }
        guard let current = shown else {
            // CRGT came straight from the network (nothing was kept yet): it is current; now it is kept too
            return
        }
        if current.hash == page.hash || PageStore.compare(page.version, current.version) < 0 && current.source == "built-in" { return }
        newer = page
        js("__crgtHost.update(\(Self.json(["version": page.version])))")
    }

    private func isCRGT(_ url: URL) -> Bool {
        guard url.host == Self.siteHost else { return false }
        let p = url.path
        return p == "/crgt" || p == "/crgt/" || p == "/crgt/index.html"
    }

    private func openOutside(_ url: URL) {
        guard let s = url.scheme?.lowercased(), ["http", "https", "mailto", "tel"].contains(s) else { return }
        UIApplication.shared.open(url)
    }

    // MARK: native → page

    private func js(_ code: String) {
        web.evaluateJavaScript("void(window.__crgtHost&&" + code + ")", completionHandler: nil)
    }

    private func statusInfo() -> [String: Any] {
        var s: [String: Any] = [
            "network": midi.networkInfo(),
            "virtual": midi.hasVirtual,
            "running": midi.running,
            "inputs": midi.sources.count,
            "outputs": midi.destinations.count,
            "page": shown?.version ?? "",
            "pageSource": shown?.source ?? "network",
        ]
        if let n = newer { s["update"] = n.version }
        return s
    }

    private func pushStatus() {
        var s = statusInfo()
        s["ports"] = midi.ports()
        js("__crgtHost.ports(\(Self.json(s)))")
    }

    // MARK: page → native

    func handle(_ message: WKScriptMessage, reply: @escaping (Any?, String?) -> Void) {
        let host = message.frameInfo.securityOrigin.host
        guard message.frameInfo.isMainFrame, host.isEmpty || host == Self.siteHost else {
            reply(nil, "not allowed from this page"); return
        }
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            reply(nil, "bad message"); return
        }
        switch op {
        case "midi":
            let st = midi.start()
            if st == noErr {
                var s = statusInfo()
                s["ports"] = midi.ports()
                reply(s, nil)
            } else {
                reply(nil, "CoreMIDI error \(st)")
            }
        case "send":
            guard let id = body["id"] as? String, let data = body["data"] as? [Any] else { reply(nil, "bad send"); return }
            let bytes = data.compactMap { ($0 as? NSNumber)?.uint8Value }
            let delay = (body["delay"] as? NSNumber)?.doubleValue ?? 0
            midi.send(id: id, bytes: bytes, delayMs: delay)
            reply(true, nil)
        case "status":
            reply(statusInfo(), nil)
        case "network":
            midi.setNetwork((body["on"] as? Bool) ?? false)
            reply(midi.networkInfo(), nil)
            pushStatus()
        case "bluetooth":
            presentBluetooth(peripheral: (body["mode"] as? String) == "peripheral")
            reply(true, nil)
        case "update":
            checkForUpdate(force: true)
            reply(statusInfo(), nil)
        case "reload":
            reply(true, nil)
            newer = nil
            DispatchQueue.main.async { self.loadBest() }
        case "retry":
            reply(true, nil)
            checkForUpdate(force: true)
            loadBest()
        default:
            reply(nil, "unknown request \(op)")
        }
    }

    // MARK: Bluetooth MIDI (iOS's own pairing screens)

    private func presentBluetooth(peripheral: Bool) {
        let vc: UIViewController = peripheral ? CABTMIDILocalPeripheralViewController() : CABTMIDICentralViewController()
        vc.navigationItem.title = peripheral ? "Bluetooth MIDI: this iPad" : "Bluetooth MIDI devices"
        vc.navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(closeSheet))
        let nav = UINavigationController(rootViewController: vc)
        nav.modalPresentationStyle = .formSheet
        presenter().present(nav, animated: true)
    }

    @objc private func closeSheet() {
        presenter().dismiss(animated: true) { [weak self] in self?.midi.refresh() }
    }

    private func presenter() -> UIViewController {
        var p: UIViewController = view.window?.rootViewController ?? self
        while let q = p.presentedViewController, !q.isBeingDismissed { p = q }
        return p
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload { decisionHandler(.download); return }
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "blob" || scheme == "data" || scheme == "about" { decisionHandler(.allow); return }
        guard let frame = navigationAction.targetFrame else {   // a new window: outside the app
            openOutside(url); decisionHandler(.cancel); return
        }
        if !frame.isMainFrame { decisionHandler(.allow); return }
        if isCRGT(url) {
            if ownLoad && navigationAction.navigationType != .reload {
                ownLoad = false; decisionHandler(.allow); return
            }
            if let cur = webView.url, url.fragment != nil,
               cur.absoluteString.components(separatedBy: "#")[0] == url.absoluteString.components(separatedBy: "#")[0] {
                decisionHandler(.allow); return   // a jump inside the page
            }
            // a reload, or CRGT opening itself: the kept copy, never the network
            decisionHandler(.cancel)
            DispatchQueue.main.async { self.loadBest() }
            return
        }
        openOutside(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if shown == nil { checkForUpdate(force: true) }   // straight from the network: keep it for next time
        else { DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in self?.checkForUpdate(force: false) } }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return }   // frame load interrupted (a download)
        if shown == nil { showOffline() }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loadBest()   // the iPad ran short of memory: open CRGT again (it restores the session it saved)
    }

    // MARK: windows and dialogs

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { openOutside(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        presenter().present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        presenter().present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { [weak a] _ in completionHandler(a?.textFields?.first?.text ?? "") })
        presenter().present(a, animated: true)
    }

    // MARK: files CRGT saves (takes, session exports): through the share sheet, so Save to Files works

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("CRGT exports", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let clean = suggestedFilename.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        let url = dir.appendingPathComponent(clean.isEmpty ? "CRGT file" : clean)
        try? FileManager.default.removeItem(at: url)
        exports[ObjectIdentifier(download)] = url
        completionHandler(url)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = exports.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            pop.permittedArrowDirections = []
        }
        presenter().present(sheet, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        exports.removeValue(forKey: ObjectIdentifier(download))
        print("CRGT Host: a file could not be saved: \(error)")
    }

    // MARK: helpers

    static func json(_ v: Any) -> String {
        guard JSONSerialization.isValidJSONObject(v),
              let d = try? JSONSerialization.data(withJSONObject: v),
              let s = String(data: d, encoding: .utf8) else { return "null" }
        return s
    }
}
