// Agent Office Pet — jendela kecil transparan, selalu di atas, berisi http://127.0.0.1:4316/pet.html.
// Seret untuk memindahkan (posisi diingat), klik untuk membuka Agent Office, klik kanan untuk menu.
// Build: desktop/build.sh
import Cocoa
import WebKit

let baseURL = URL(string: "http://127.0.0.1:4316/")!
let petURL = URL(string: "http://127.0.0.1:4316/pet.html")!

/// Panel tanpa bingkai yang tetap bisa menerima klik tanpa mengaktifkan aplikasi.
final class PetPanel: NSPanel {
  override var canBecomeKey: Bool { true }
}

/// WebView yang menerima klik pertama (tanpa harus fokus dulu).
final class PetWebView: WKWebView {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
  var panel: PetPanel!
  var web: PetWebView!
  var dragMonitor: Any?
  var dragOrigin = NSPoint.zero
  var mouseStart = NSPoint.zero
  var loadFailed = false
  var hideTimer: Timer?

  func applicationDidFinishLaunching(_ notification: Notification) {
    let size = NSSize(width: 220, height: 210)
    let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    var origin = NSPoint(x: visible.maxX - size.width - 24, y: visible.minY + 16)
    if let saved = UserDefaults.standard.string(forKey: "origin") {
      let p = NSPointFromString(saved)
      if NSScreen.screens.contains(where: { $0.visibleFrame.insetBy(dx: -40, dy: -40).contains(p) }) { origin = p }
    }

    panel = PetPanel(
      contentRect: NSRect(origin: origin, size: size),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false)
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.level = .floating
    panel.hidesOnDeactivate = false
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]

    let config = WKWebViewConfiguration()
    config.userContentController.add(self, name: "pet")
    web = PetWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
    web.setValue(false, forKey: "drawsBackground")
    web.navigationDelegate = self
    panel.contentView = web
    web.load(URLRequest(url: petURL))
    panel.orderFrontRegardless()

    // Server belum menyala (mis. baru login): coba muat ulang berkala.
    Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
      guard let self, self.loadFailed else { return }
      self.loadFailed = false
      self.web.load(URLRequest(url: petURL))
    }
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    loadFailed = true
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    loadFailed = true
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
    switch type {
    case "dragStart": startDrag()
    case "open":
      let url = (body["url"] as? String).flatMap(URL.init(string:)) ?? baseURL
      if url.host == "127.0.0.1" { NSWorkspace.shared.open(url) }
    case "menu": showMenu()
    case "resize":
      if let w = body["w"] as? Double, let h = body["h"] as? Double { resize(to: NSSize(width: w, height: h)) }
    case "copy":
      if let text = body["text"] as? String {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
      }
    case "attention":
      // Ada izin/pertanyaan/pesan baru: munculkan lagi walau sedang disembunyikan.
      hideTimer?.invalidate()
      panel.orderFrontRegardless()
    default: break
    }
  }

  /// Pet di separuh kiri layar → kartu membuka ke kanan, dan sebaliknya.
  var side: String {
    let screen = panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
    return panel.frame.midX < screen.midX ? "left" : "right"
  }

  func tellSide() {
    web.evaluateJavaScript("window.petSide && window.petSide('\(side)')", completionHandler: nil)
  }

  /// Ubah ukuran jendela mengikuti isi halaman; sudut bawah di sisi pet tetap di tempat.
  func resize(to size: NSSize) {
    let old = panel.frame
    let screen = panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? old
    let w = min(max(size.width, 140), screen.width)
    let h = min(max(size.height, 140), screen.height)
    var x = side == "left" ? old.minX : old.maxX - w
    x = min(max(x, screen.minX), screen.maxX - w)
    let y = max(old.minY, screen.minY)
    panel.setFrame(NSRect(x: x, y: y, width: w, height: h), display: true)
    web.frame = NSRect(origin: .zero, size: NSSize(width: w, height: h))
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    tellSide()
  }

  /// Pindahkan jendela mengikuti mouse sampai tombol dilepas.
  func startDrag() {
    mouseStart = NSEvent.mouseLocation
    dragOrigin = panel.frame.origin
    if let m = dragMonitor { NSEvent.removeMonitor(m) }
    dragMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged, .leftMouseUp]) { [weak self] event in
      guard let self else { return event }
      if event.type == .leftMouseUp {
        if let m = self.dragMonitor { NSEvent.removeMonitor(m) }
        self.dragMonitor = nil
        UserDefaults.standard.set(NSStringFromPoint(self.panel.frame.origin), forKey: "origin")
        self.tellSide()
        return event
      }
      let p = NSEvent.mouseLocation
      self.panel.setFrameOrigin(NSPoint(x: self.dragOrigin.x + p.x - self.mouseStart.x, y: self.dragOrigin.y + p.y - self.mouseStart.y))
      return event
    }
  }

  func showMenu() {
    let menu = NSMenu()
    menu.addItem(withTitle: "Buka Agent Office", action: #selector(openOffice), keyEquivalent: "").target = self
    menu.addItem(withTitle: "Buka Katalog", action: #selector(openCatalog), keyEquivalent: "").target = self
    menu.addItem(.separator())
    menu.addItem(withTitle: "Sembunyikan 1 jam", action: #selector(hideForAnHour), keyEquivalent: "").target = self
    menu.addItem(withTitle: "Kembalikan ke pojok kanan bawah", action: #selector(resetPosition), keyEquivalent: "").target = self
    menu.addItem(.separator())
    menu.addItem(withTitle: "Keluar (muncul lagi saat login berikutnya)", action: #selector(quit), keyEquivalent: "").target = self
    menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
  }

  @objc func openOffice() { NSWorkspace.shared.open(baseURL) }
  @objc func openCatalog() { NSWorkspace.shared.open(URL(string: "http://127.0.0.1:4316/catalog.html")!) }
  @objc func hideForAnHour() {
    panel.orderOut(nil)
    hideTimer?.invalidate()
    hideTimer = Timer.scheduledTimer(withTimeInterval: 3600, repeats: false) { [weak self] _ in self?.panel.orderFrontRegardless() }
  }
  @objc func resetPosition() {
    let visible = NSScreen.main?.visibleFrame ?? .zero
    panel.setFrameOrigin(NSPoint(x: visible.maxX - panel.frame.width - 24, y: visible.minY + 16))
    UserDefaults.standard.removeObject(forKey: "origin")
    tellSide()
  }
  @objc func quit() { NSApp.terminate(nil) }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory) // tanpa ikon Dock
app.run()
