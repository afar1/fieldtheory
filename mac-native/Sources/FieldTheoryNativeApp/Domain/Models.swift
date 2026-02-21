import Foundation

enum TranscriptionState: String, Codable {
    case idle
    case recording
    case transcribing

    var menuBarSymbolName: String {
        switch self {
        case .idle:
            return "mic"
        case .recording:
            return "mic.fill"
        case .transcribing:
            return "waveform.and.magnifyingglass"
        }
    }
}

enum TranscriptionEngineKind: String, Codable, CaseIterable, Identifiable {
    case whisper
    case qwen

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .whisper:
            return "Whisper"
        case .qwen:
            return "Qwen"
        }
    }
}

enum TranscriptionRecordingBackendKind: String, Codable, Equatable {
    case helper
    case avAudioRecorder
}

struct TranscriptionEngineDiagnostic: Identifiable, Equatable {
    let engine: TranscriptionEngineKind
    let available: Bool
    let message: String

    var id: String { engine.rawValue }
}

enum ClipboardItemType: String, Codable, CaseIterable {
    case text
    case image
    case transcript
    case screenshot
}

enum ClipboardSource: String, Codable, CaseIterable {
    case mac
    case ios
}

struct ClipboardItem: Identifiable, Codable, Hashable {
    let id: Int64
    var type: ClipboardItemType
    var content: String?
    var createdAt: Date
    var source: ClipboardSource
    var stackID: String?
    var wordCount: Int?

    init(
        id: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        type: ClipboardItemType,
        content: String?,
        createdAt: Date = Date(),
        source: ClipboardSource = .mac,
        stackID: String? = nil,
        wordCount: Int? = nil
    ) {
        self.id = id
        self.type = type
        self.content = content
        self.createdAt = createdAt
        self.source = source
        self.stackID = stackID
        self.wordCount = wordCount
    }
}

struct PortableCommand: Identifiable, Hashable {
    var id: String { filePath }
    let name: String
    let displayName: String
    let filePath: String
}

struct HotkeyConfiguration: Codable, Equatable {
    var transcription: String
    var screenshot: String
    var clipboardHistory: String
    var commandLauncher: String
    var continuousContext: String

    static let `default` = HotkeyConfiguration(
        transcription: "Command+\\",
        screenshot: "Alt+4",
        clipboardHistory: "Alt+Space",
        commandLauncher: "Command+Shift+K",
        continuousContext: "Shift+Alt+4"
    )
}

enum PermissionState: String, Codable {
    case granted
    case denied
    case notDetermined
}

struct PermissionSnapshot: Codable, Equatable {
    var microphone: PermissionState
    var accessibility: Bool
    var screenRecording: Bool

    static let empty = PermissionSnapshot(
        microphone: .notDetermined,
        accessibility: false,
        screenRecording: false
    )
}

struct AudioInputDevice: Codable, Hashable {
    let id: String
    let name: String
}

struct SyncStatus: Codable, Equatable {
    var isSignedIn: Bool
    var lastSyncDate: Date?
    var statusLine: String

    static let disconnected = SyncStatus(
        isSignedIn: false,
        lastSyncDate: nil,
        statusLine: "Not signed in"
    )
}
