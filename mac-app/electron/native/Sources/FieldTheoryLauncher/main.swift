import AppKit
import Foundation

private let launchedAtMs = Double(ProcessInfo.processInfo.environment["FIELD_THEORY_STARTUP_LAUNCHED_AT_MS"] ?? "")
private let bootDate = Date()

private func mark(_ stage: String) {
    guard ProcessInfo.processInfo.environment["FIELD_THEORY_STARTUP_PROFILE"] == "1" else { return }
    let now = Date()
    let moduleMs = Int(now.timeIntervalSince(bootDate) * 1000)
    let launchedMs = launchedAtMs.map { Int(now.timeIntervalSince1970 * 1000 - $0) }
    let launchedText = launchedMs.map(String.init) ?? "n/a"
    print("[NativeLauncher] \(stage) moduleMs=\(moduleMs) launchedMs=\(launchedText)")
    fflush(stdout)
}

private final class LauncherDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var electronProcess: Process?

    func applicationDidFinishLaunching(_ notification: Notification) {
        mark("app-ready")
        showStartupWindow()

        if ProcessInfo.processInfo.environment["FIELD_THEORY_LAUNCHER_BENCH_ONLY"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                NSApp.terminate(nil)
            }
            return
        }

        launchElectron(arguments: Array(CommandLine.arguments.dropFirst()), terminateWithElectron: true)
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        forwardToElectron(urls.map(\.absoluteString))
    }

    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        forwardToElectron(filenames)
        sender.reply(toOpenOrPrint: .success)
    }

    private func showStartupWindow() {
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = NSSize(width: 320, height: 96)
        let origin = NSPoint(
            x: screenFrame.midX - size.width / 2,
            y: screenFrame.midY - size.height / 2
        )
        let window = NSWindow(
            contentRect: NSRect(origin: origin, size: size),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.backgroundColor = NSColor(calibratedWhite: 0.97, alpha: 0.98)
        window.level = .floating
        window.hasShadow = true

        let container = NSView(frame: NSRect(origin: .zero, size: size))
        container.wantsLayer = true
        container.layer?.cornerRadius = 12
        container.layer?.backgroundColor = NSColor(calibratedWhite: 0.97, alpha: 0.98).cgColor
        window.contentView = container
        self.window = window
        window.makeKeyAndOrderFront(nil)
        mark("window-shown")

        DispatchQueue.main.async { [weak container] in
            guard let container else { return }
            let title = NSTextField(labelWithString: "Field Theory")
            title.font = NSFont.systemFont(ofSize: 17, weight: .semibold)
            title.textColor = NSColor(calibratedWhite: 0.12, alpha: 1)
            title.frame = NSRect(x: 24, y: 46, width: 220, height: 24)
            container.addSubview(title)

            let subtitle = NSTextField(labelWithString: "Opening...")
            subtitle.font = NSFont.systemFont(ofSize: 13, weight: .regular)
            subtitle.textColor = NSColor(calibratedWhite: 0.38, alpha: 1)
            subtitle.frame = NSRect(x: 24, y: 24, width: 220, height: 20)
            container.addSubview(subtitle)
        }
    }

    private func forwardToElectron(_ arguments: [String]) {
        guard !arguments.isEmpty else { return }
        launchElectron(arguments: arguments, terminateWithElectron: electronProcess == nil)
    }

    private func launchElectron(arguments: [String], terminateWithElectron: Bool) {
        let electronURL = resolveElectronURL()

        guard FileManager.default.isExecutableFile(atPath: electronURL.path) else {
            mark("electron-missing")
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                NSApp.terminate(nil)
            }
            return
        }

        let process = Process()
        process.executableURL = electronURL
        process.arguments = electronArguments(with: arguments)
        process.environment = ProcessInfo.processInfo.environment
        process.standardOutput = FileHandle.standardOutput
        process.standardError = FileHandle.standardError
        if terminateWithElectron {
            process.terminationHandler = { _ in
                DispatchQueue.main.async {
                    NSApp.terminate(nil)
                }
            }
        }

        do {
            try process.run()
            if terminateWithElectron {
                electronProcess = process
            }
            mark("electron-launched")
            if terminateWithElectron {
                DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
                    self?.window?.close()
                }
            }
        } catch {
            mark("electron-launch-failed")
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                NSApp.terminate(nil)
            }
        }
    }

    private func resolveElectronURL() -> URL {
        if let devElectronPath = ProcessInfo.processInfo.environment["FIELD_THEORY_LAUNCHER_ELECTRON_PATH"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !devElectronPath.isEmpty {
            return URL(fileURLWithPath: devElectronPath)
        }

        let launcherPath = URL(fileURLWithPath: CommandLine.arguments[0])
        let electronName = launcherPath.lastPathComponent + " Electron"
        return launcherPath.deletingLastPathComponent().appendingPathComponent(electronName)
    }

    private func electronArguments(with forwardedArguments: [String]) -> [String] {
        guard let devAppPath = ProcessInfo.processInfo.environment["FIELD_THEORY_LAUNCHER_ELECTRON_APP_PATH"]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !devAppPath.isEmpty else {
            return forwardedArguments
        }

        return [devAppPath] + forwardedArguments
    }
}

mark("process-start")
let app = NSApplication.shared
private let delegate = LauncherDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
