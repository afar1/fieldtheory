import AVFoundation
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

@MainActor
final class DefaultGlobalHotkeyService: GlobalHotkeyService {
    private let defaults = UserDefaults.standard
    private let key = "fieldTheoryNative.hotkeys"

    private var configuration: HotkeyConfiguration
    private var handlers: [HotkeyAction: () -> Void] = [:]
    private var parsedHotkeys: [HotkeyAction: ParsedHotkey] = [:]
    private var globalMonitor: Any?
    private var localMonitor: Any?

    private static let modifierMask: NSEvent.ModifierFlags = [.command, .option, .control, .shift]

    init() {
        if
            let data = defaults.data(forKey: key),
            let decoded = try? JSONDecoder().decode(HotkeyConfiguration.self, from: data)
        {
            self.configuration = decoded
        } else {
            self.configuration = .default
        }
        self.parsedHotkeys = Self.buildHotkeys(from: configuration)
    }

    func currentConfiguration() -> HotkeyConfiguration {
        configuration
    }

    func updateConfiguration(_ configuration: HotkeyConfiguration) {
        self.configuration = configuration
        guard let data = try? JSONEncoder().encode(configuration) else { return }
        defaults.set(data, forKey: key)
        parsedHotkeys = Self.buildHotkeys(from: configuration)
    }

    func setHandler(for action: HotkeyAction, handler: @escaping () -> Void) {
        handlers[action] = handler
    }

    func startListening() {
        if globalMonitor != nil || localMonitor != nil {
            return
        }

        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.handle(event: event)
        }

        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.handle(event: event)
            return event
        }
    }

    func stopListening() {
        if let globalMonitor {
            NSEvent.removeMonitor(globalMonitor)
            self.globalMonitor = nil
        }

        if let localMonitor {
            NSEvent.removeMonitor(localMonitor)
            self.localMonitor = nil
        }
    }

    private func handle(event: NSEvent) {
        if event.isARepeat {
            return
        }

        let eventModifiers = event.modifierFlags.intersection(Self.modifierMask)
        guard let eventKeyToken = Self.keyToken(from: event) else { return }

        for action in HotkeyAction.allCases {
            guard let hotkey = parsedHotkeys[action] else { continue }
            guard hotkey.modifiers == eventModifiers else { continue }
            guard hotkey.keyToken == eventKeyToken else { continue }

            handlers[action]?()
            break
        }
    }

    private static func buildHotkeys(from configuration: HotkeyConfiguration) -> [HotkeyAction: ParsedHotkey] {
        var output: [HotkeyAction: ParsedHotkey] = [:]

        output[.transcription] = parseHotkey(configuration.transcription)
        output[.screenshot] = parseHotkey(configuration.screenshot)
        output[.clipboardHistory] = parseHotkey(configuration.clipboardHistory)
        output[.commandLauncher] = parseHotkey(configuration.commandLauncher)
        output[.continuousContext] = parseHotkey(configuration.continuousContext)

        return output
    }

    private static func parseHotkey(_ text: String) -> ParsedHotkey? {
        let parts = text
            .split(separator: "+")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.isEmpty == false }

        guard parts.isEmpty == false else { return nil }

        var modifiers: NSEvent.ModifierFlags = []
        var keyToken: String?

        for rawPart in parts {
            let part = rawPart.lowercased()
            switch part {
            case "command", "cmd", "commandorcontrol":
                modifiers.insert(.command)
            case "shift":
                modifiers.insert(.shift)
            case "alt", "option":
                modifiers.insert(.option)
            case "control", "ctrl":
                modifiers.insert(.control)
            default:
                keyToken = normalizeKeyToken(part)
            }
        }

        guard let keyToken else { return nil }
        return ParsedHotkey(modifiers: modifiers, keyToken: keyToken)
    }

    private static func normalizeKeyToken(_ value: String) -> String {
        switch value {
        case "\\", "backslash":
            return "\\"
        case "space", "spacebar":
            return "space"
        case "enter", "return":
            return "return"
        case "esc", "escape":
            return "escape"
        case "up", "arrowup":
            return "up"
        case "down", "arrowdown":
            return "down"
        case "left", "arrowleft":
            return "left"
        case "right", "arrowright":
            return "right"
        default:
            return value.lowercased()
        }
    }

    private static func keyToken(from event: NSEvent) -> String? {
        switch event.keyCode {
        case 36:
            return "return"
        case 49:
            return "space"
        case 53:
            return "escape"
        case 123:
            return "left"
        case 124:
            return "right"
        case 125:
            return "down"
        case 126:
            return "up"
        default:
            break
        }

        guard var characters = event.charactersIgnoringModifiers else { return nil }
        characters = characters.trimmingCharacters(in: .whitespacesAndNewlines)
        guard characters.isEmpty == false else {
            if event.keyCode == 49 {
                return "space"
            }
            return nil
        }

        if characters.count > 1 {
            return characters.lowercased()
        }

        return characters.lowercased()
    }

    private struct ParsedHotkey {
        let modifiers: NSEvent.ModifierFlags
        let keyToken: String
    }
}

@MainActor
final class DefaultPermissionService: PermissionService {
    func currentSnapshot() -> PermissionSnapshot {
        let microphone: PermissionState

        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            microphone = .granted
        case .notDetermined:
            microphone = .notDetermined
        case .denied, .restricted:
            microphone = .denied
        @unknown default:
            microphone = .denied
        }

        let accessibility = AXIsProcessTrusted()
        let screenRecording: Bool

        if #available(macOS 10.15, *) {
            screenRecording = CGPreflightScreenCaptureAccess()
        } else {
            screenRecording = true
        }

        return PermissionSnapshot(
            microphone: microphone,
            accessibility: accessibility,
            screenRecording: screenRecording
        )
    }

    func requestMicrophonePermission() {
        AVCaptureDevice.requestAccess(for: .audio) { _ in }
    }
}

@MainActor
final class DefaultAudioDeviceService: AudioDeviceService {
    func currentInputDevices() -> [AudioInputDevice] {
        // Placeholder for CoreAudio-backed implementation.
        []
    }
}

@MainActor
final class FilesystemCommandService: CommandService {
    private let directories: [URL]

    init(directories: [URL] = [
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".claude/commands"),
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".cursor/rules"),
    ]) {
        self.directories = directories
    }

    func listCommands() -> [PortableCommand] {
        let fileManager = FileManager.default
        var commands: [PortableCommand] = []

        for directory in directories {
            guard let enumerator = fileManager.enumerator(
                at: directory,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
            ) else {
                continue
            }

            for case let url as URL in enumerator {
                guard url.pathExtension.lowercased() == "md" else { continue }
                let name = url.deletingPathExtension().lastPathComponent
                commands.append(
                    PortableCommand(
                        name: name,
                        displayName: name.replacingOccurrences(of: "-", with: " "),
                        filePath: url.path
                    )
                )
            }
        }

        return commands.sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
    }
}

@MainActor
final class NoopSyncService: SyncService {
    let supportsCloudWrites: Bool = false

    func currentStatus() -> SyncStatus {
        .disconnected
    }
}
