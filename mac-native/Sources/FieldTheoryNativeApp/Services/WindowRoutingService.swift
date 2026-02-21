import AppKit
import SwiftUI

@MainActor
final class WindowRoutingService {
    private var fallbackWindows: [AppWindow: NSWindow] = [:]

    func show(_ appWindow: AppWindow, model: AppModel) {
        if let existing = existingWindow(for: appWindow) {
            bringToFront(existing)
            return
        }

        let fallback = makeFallbackWindow(for: appWindow, model: model)
        bringToFront(fallback)
    }

    private func existingWindow(for appWindow: AppWindow) -> NSWindow? {
        NSApplication.shared.windows.first { window in
            let idMatches = window.identifier?.rawValue == appWindow.rawValue
            let titleMatches = window.title == appWindow.title
            return idMatches || titleMatches
        }
    }

    private func makeFallbackWindow(for appWindow: AppWindow, model: AppModel) -> NSWindow {
        if let existing = fallbackWindows[appWindow] {
            return existing
        }

        let rootView: AnyView
        let size: NSSize

        switch appWindow {
        case .clipboardHistory:
            rootView = AnyView(ClipboardHistoryView().environmentObject(model))
            size = NSSize(width: 960, height: 680)
        case .commandLauncher:
            rootView = AnyView(CommandLauncherView().environmentObject(model))
            size = NSSize(width: 600, height: 420)
        case .recordingOverlay:
            rootView = AnyView(RecordingOverlayView().environmentObject(model))
            size = NSSize(width: 320, height: 120)
        }

        let hosting = NSHostingController(rootView: rootView)
        let window = NSWindow(contentViewController: hosting)
        window.identifier = NSUserInterfaceItemIdentifier(appWindow.rawValue)
        window.title = appWindow.title
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
        window.setContentSize(size)
        window.center()
        window.isReleasedWhenClosed = false
        fallbackWindows[appWindow] = window
        return window
    }

    private func bringToFront(_ window: NSWindow) {
        NSApp.activate(ignoringOtherApps: true)
        if window.isMiniaturized {
            window.deminiaturize(nil)
        }
        window.makeKeyAndOrderFront(nil)
    }
}
