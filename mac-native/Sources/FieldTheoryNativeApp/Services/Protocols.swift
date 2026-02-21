import Foundation

enum HotkeyAction: CaseIterable {
    case transcription
    case screenshot
    case clipboardHistory
    case commandLauncher
    case continuousContext
}

@MainActor
protocol GlobalHotkeyService {
    func currentConfiguration() -> HotkeyConfiguration
    func updateConfiguration(_ configuration: HotkeyConfiguration)
    func setHandler(for action: HotkeyAction, handler: @escaping () -> Void)
    func startListening()
    func stopListening()
}

@MainActor
protocol PermissionService {
    func currentSnapshot() -> PermissionSnapshot
    func requestMicrophonePermission()
}

@MainActor
protocol AudioDeviceService {
    func currentInputDevices() -> [AudioInputDevice]
}

@MainActor
protocol TranscriptionService {
    var state: TranscriptionState { get }
    var selectedEngine: TranscriptionEngineKind { get }
    var availableEngines: [TranscriptionEngineKind] { get }
    var recordingBackend: TranscriptionRecordingBackendKind { get }
    var supportsRecordingSnapshots: Bool { get }
    var engineDiagnostics: [TranscriptionEngineDiagnostic] { get }
    var lastError: String? { get }
    func setSelectedEngine(_ engine: TranscriptionEngineKind)
    func startRecording()
    func cancelRecording()
    func snapshotRecording() -> String?
    func stopRecording() -> String?
}

@MainActor
protocol ClipboardStore {
    var supportsDelete: Bool { get }
    func fetchRecent(limit: Int) -> [ClipboardItem]
    func insert(_ item: ClipboardItem)
    func delete(id: Int64)
}

@MainActor
protocol CommandService {
    func listCommands() -> [PortableCommand]
}

@MainActor
protocol SyncService {
    var supportsCloudWrites: Bool { get }
    func currentStatus() -> SyncStatus
}
