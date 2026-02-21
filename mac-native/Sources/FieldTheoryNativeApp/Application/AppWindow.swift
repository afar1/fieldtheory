import Foundation

enum AppWindow: String {
    case clipboardHistory = "clipboard-history"
    case commandLauncher = "command-launcher"
    case recordingOverlay = "recording-overlay"

    var title: String {
        switch self {
        case .clipboardHistory:
            return "Clipboard History"
        case .commandLauncher:
            return "Command Launcher"
        case .recordingOverlay:
            return "Recording Overlay"
        }
    }
}
