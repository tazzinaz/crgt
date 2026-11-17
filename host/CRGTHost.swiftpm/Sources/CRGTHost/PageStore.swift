// The copy of CRGT the app runs. CRGT is one HTML file (tazzinaz.github.io/crgt/index.html, the offline build), so the
// app keeps it itself: the copy built into the app, and the newest one downloaded from GitHub Pages. It opens the newer
// of the two at once, with no connection needed, and looks for a new version in the background.

import Foundation
import CryptoKit

struct CRGTPage {
    let html: String
    let version: String
    let hash: String
    let source: String   // "built-in" or "saved"
}

final class PageStore {
    private let fm = FileManager.default

    private lazy var dir: URL = {
        let base = (try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? fm.temporaryDirectory
        let d = base.appendingPathComponent("CRGT", isDirectory: true)
        try? fm.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    private var savedFile: URL { dir.appendingPathComponent("index.html") }

    /// The newest CRGT on this iPad, or nil when there is none yet (first launch without the built-in copy).
    func best() -> CRGTPage? {
        let saved = load(savedFile, source: "saved")
        let builtIn = Self.builtInURL().flatMap { load($0, source: "built-in") }
        switch (saved, builtIn) {
        case let (s?, b?): return Self.compare(b.version, s.version) > 0 ? b : s
        case let (s?, nil): return s
        case let (nil, b?): return b
        default: return nil
        }
    }

    /// Keeps a downloaded CRGT if it is one (it carries the crgt-offline version tag). Returns it, saved.
    func keep(_ data: Data) -> CRGTPage? {
        guard let html = String(data: data, encoding: .utf8), let v = Self.version(of: html) else { return nil }
        let page = CRGTPage(html: html, version: v, hash: Self.hash(data), source: "saved")
        if let old = try? Data(contentsOf: savedFile), Self.hash(old) == page.hash { return page }
        do { try data.write(to: savedFile, options: .atomic) } catch { return nil }
        return page
    }

    private func load(_ url: URL, source: String) -> CRGTPage? {
        guard let data = try? Data(contentsOf: url),
              let html = String(data: data, encoding: .utf8),
              let v = Self.version(of: html) else { return nil }
        return CRGTPage(html: html, version: v, hash: Self.hash(data), source: source)
    }

    /// "v38" from <meta name="crgt-offline" content="v38">, near the top of the file.
    static func version(of html: String) -> String? {
        let head = String(html.prefix(8192))
        guard let r = head.range(of: "<meta name=\"crgt-offline\" content=\"") else { return nil }
        let rest = head[r.upperBound...]
        guard let end = rest.firstIndex(of: "\""), end > rest.startIndex else { return nil }
        return String(rest[..<end])
    }

    /// Compares "v37", "v36.1" and the like number by number: -1, 0 or 1.
    static func compare(_ a: String, _ b: String) -> Int {
        func parts(_ s: String) -> [Int] { s.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) } }
        let x = parts(a), y = parts(b)
        for i in 0..<max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0
            let q = i < y.count ? y[i] : 0
            if p != q { return p < q ? -1 : 1 }
        }
        return 0
    }

    static func hash(_ d: Data) -> String {
        String(SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined().prefix(16))
    }

    /// Resources/crgt.html in the app (Xcode puts package resources in a .bundle inside the app; look everywhere).
    static func builtInURL() -> URL? {
        var bundles: [Bundle] = [Bundle.main]
        if let items = try? FileManager.default.contentsOfDirectory(at: Bundle.main.bundleURL, includingPropertiesForKeys: nil) {
            for u in items where u.pathExtension == "bundle" {
                if let b = Bundle(url: u) { bundles.append(b) }
            }
        }
        for b in bundles {
            if let u = b.url(forResource: "crgt", withExtension: "html", subdirectory: "Resources")
                ?? b.url(forResource: "crgt", withExtension: "html") {
                return u
            }
        }
        return nil
    }
}
