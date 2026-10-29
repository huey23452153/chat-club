// Chat Club for iPhone: the live site (chat-club-one.vercel.app) in a full-screen web view, with
// camera and mic for calls, the photo picker, alert/confirm/prompt boxes, and links to other sites
// opening in Safari. The site itself is the app, so deploying the site updates this too.
import SwiftUI
import WebKit

let siteURL = URL(string: "https://chat-club-one.vercel.app")!

@main
struct ChatClubApp: App {
    var body: some Scene {
        WindowGroup {
            ChatClubWebView()
                .ignoresSafeArea(.keyboard)
                .background(Color(red: 29 / 255, green: 120 / 255, blue: 116 / 255).ignoresSafeArea())
        }
    }
}

struct ChatClubWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // stays logged in
        config.allowsInlineMediaPlayback = true // calls and Watch together play in the page, not full screen
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "ChatClubApp"
        if #available(iOS 16.4, *) { config.preferences.isElementFullscreenEnabled = true } // full-screen profile pics

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { web.isInspectable = true } // Safari > Develop on a Mac can look inside
        web.load(URLRequest(url: siteURL))
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        // links to other sites go to Safari; Chat Club itself (and things inside it, like YouTube) stay here
        func webView(_ web: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = action.request.url, action.targetFrame?.isMainFrame == true,
               url.host != siteURL.host, url.scheme == "http" || url.scheme == "https" {
                UIApplication.shared.open(url)
                return decisionHandler(.cancel)
            }
            if let url = action.request.url, let scheme = url.scheme, !["http", "https", "about", "blob", "data"].contains(scheme) {
                UIApplication.shared.open(url) // mailto:, tel:, …
                return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }

        // target="_blank" links and window.open
        func webView(_ web: WKWebView, createWebViewWith config: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url {
                if url.host == siteURL.host { web.load(action.request) } else { UIApplication.shared.open(url) }
            }
            return nil
        }

        // if iOS stops the page in the background, load it again
        func webViewWebContentProcessDidTerminate(_ web: WKWebView) { web.reload() }

        // camera and mic for calls: iOS asks the person once (the reasons are in the build settings)
        @available(iOS 15.0, *)
        func webView(_ web: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(origin.host == siteURL.host ? .grant : .prompt)
        }

        // alert(), confirm() and prompt() do nothing in a web view unless the app shows them
        func webView(_ web: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let box = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            box.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            show(box, from: web) { completionHandler() }
        }

        func webView(_ web: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let box = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            box.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            box.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            show(box, from: web) { completionHandler(false) }
        }

        func webView(_ web: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            let box = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            box.addTextField { $0.text = defaultText }
            box.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
            box.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(box.textFields?.first?.text) })
            show(box, from: web) { completionHandler(nil) }
        }

        private func show(_ box: UIAlertController, from web: WKWebView, otherwise: () -> Void) {
            var top = web.window?.rootViewController
            while let next = top?.presentedViewController { top = next }
            guard let top else { return otherwise() }
            top.present(box, animated: true)
        }
    }
}
