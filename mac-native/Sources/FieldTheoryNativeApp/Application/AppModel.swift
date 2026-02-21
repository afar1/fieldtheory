import Foundation

@MainActor
final class AppModel: ObservableObject {
    @Published var transcriptionState: TranscriptionState = .idle
    @Published var transcriptionEngine: TranscriptionEngineKind = .whisper
    @Published var availableTranscriptionEngines: [TranscriptionEngineKind] = []
    @Published var transcriptionRecordingBackend: TranscriptionRecordingBackendKind = .avAudioRecorder
    @Published var transcriptionSupportsSnapshots: Bool = false
    @Published var transcriptionEngineDiagnostics: [TranscriptionEngineDiagnostic] = []
    @Published var transcriptionError: String?
    @Published var clipboardItems: [ClipboardItem] = []
    @Published var hotkeys: HotkeyConfiguration = .default
    @Published var permissions: PermissionSnapshot = .empty
    @Published var syncStatus: SyncStatus = .disconnected
    @Published var commands: [PortableCommand] = []

    @Published var searchQuery: String = ""
    @Published var selectedTypeFilter: ClipboardItemType? = nil
    @Published var showInDock: Bool = false
    @Published var launchAtLogin: Bool = true
    @Published var safetyModeDescription: String = ""
    @Published var canDeleteClipboardItems: Bool = false
    @Published var cloudWritesEnabled: Bool = false
    @Published var safetyNotice: String?
    @Published var safetyAuditSummary: String = ""

    private let hotkeyService: GlobalHotkeyService
    private let permissionService: PermissionService
    private let audioDeviceService: AudioDeviceService
    private let transcriptionService: TranscriptionService
    private let clipboardStore: ClipboardStore
    private let commandService: CommandService
    private let syncService: SyncService
    private let safetyManager: DataSafetyManager
    private let windowRoutingService: WindowRoutingService
    private let safetyAuditor: SafetyAuditor

    init(
        hotkeyService: GlobalHotkeyService = DefaultGlobalHotkeyService(),
        permissionService: PermissionService = DefaultPermissionService(),
        audioDeviceService: AudioDeviceService = DefaultAudioDeviceService(),
        transcriptionService: TranscriptionService? = nil,
        clipboardStore: ClipboardStore? = nil,
        commandService: CommandService = FilesystemCommandService(),
        syncService: SyncService = NoopSyncService(),
        safetyManager: DataSafetyManager = DataSafetyManager(),
        windowRoutingService: WindowRoutingService = WindowRoutingService(),
        safetyAuditor: SafetyAuditor = SafetyAuditor()
    ) {
        self.safetyManager = safetyManager
        self.windowRoutingService = windowRoutingService
        self.safetyAuditor = safetyAuditor
        self.hotkeyService = hotkeyService
        self.permissionService = permissionService
        self.audioDeviceService = audioDeviceService
        self.transcriptionService = transcriptionService ?? DefaultTranscriptionService(safetyManager: safetyManager)
        self.clipboardStore = clipboardStore ?? AppModel.makeSafeClipboardStore(safetyManager: safetyManager)
        self.commandService = commandService
        self.syncService = syncService
        self.safetyModeDescription = safetyManager.policySummary()
        self.canDeleteClipboardItems = self.clipboardStore.supportsDelete
        self.cloudWritesEnabled = self.syncService.supportsCloudWrites

        refresh()
        wireHotkeys()
    }

    private static func makeSafeClipboardStore(safetyManager: DataSafetyManager) -> ClipboardStore {
        do {
            return try SQLiteClipboardStore(safetyManager: safetyManager)
        } catch {
            return InMemoryClipboardStore()
        }
    }

    func refresh() {
        hotkeys = hotkeyService.currentConfiguration()
        permissions = permissionService.currentSnapshot()
        transcriptionState = transcriptionService.state
        transcriptionEngine = transcriptionService.selectedEngine
        availableTranscriptionEngines = transcriptionService.availableEngines
        transcriptionRecordingBackend = transcriptionService.recordingBackend
        transcriptionSupportsSnapshots = transcriptionService.supportsRecordingSnapshots
        transcriptionEngineDiagnostics = transcriptionService.engineDiagnostics
        transcriptionError = transcriptionService.lastError
        syncStatus = syncService.currentStatus()
        commands = commandService.listCommands()
        clipboardItems = clipboardStore.fetchRecent(limit: 400)
        canDeleteClipboardItems = clipboardStore.supportsDelete
        cloudWritesEnabled = syncService.supportsCloudWrites
        safetyModeDescription = safetyManager.policySummary()
        runSafetyAudit()
    }

    func requestMicrophonePermission() {
        permissionService.requestMicrophonePermission()
        permissions = permissionService.currentSnapshot()
    }

    func updateHotkeys(_ next: HotkeyConfiguration) {
        hotkeys = next
        hotkeyService.updateConfiguration(next)
        wireHotkeys()
    }

    func toggleRecording() {
        switch transcriptionState {
        case .idle:
            transcriptionService.startRecording()
            transcriptionState = transcriptionService.state
            transcriptionEngine = transcriptionService.selectedEngine
            availableTranscriptionEngines = transcriptionService.availableEngines
            transcriptionRecordingBackend = transcriptionService.recordingBackend
            transcriptionSupportsSnapshots = transcriptionService.supportsRecordingSnapshots
            transcriptionEngineDiagnostics = transcriptionService.engineDiagnostics
            transcriptionError = transcriptionService.lastError
        case .recording:
            transcriptionState = .transcribing
            let transcript = transcriptionService.stopRecording()
            transcriptionState = transcriptionService.state
            transcriptionEngine = transcriptionService.selectedEngine
            availableTranscriptionEngines = transcriptionService.availableEngines
            transcriptionRecordingBackend = transcriptionService.recordingBackend
            transcriptionSupportsSnapshots = transcriptionService.supportsRecordingSnapshots
            transcriptionEngineDiagnostics = transcriptionService.engineDiagnostics
            transcriptionError = transcriptionService.lastError

            guard let transcript, transcript.isEmpty == false else { return }

            let item = ClipboardItem(
                type: .transcript,
                content: transcript,
                createdAt: Date(),
                source: .mac,
                wordCount: transcript.split(separator: " ").count
            )
            clipboardStore.insert(item)
            clipboardItems = clipboardStore.fetchRecent(limit: 400)
        case .transcribing:
            break
        }
    }

    func setTranscriptionEngine(_ engine: TranscriptionEngineKind) {
        transcriptionService.setSelectedEngine(engine)
        transcriptionEngine = transcriptionService.selectedEngine
        availableTranscriptionEngines = transcriptionService.availableEngines
        transcriptionSupportsSnapshots = transcriptionService.supportsRecordingSnapshots
        transcriptionEngineDiagnostics = transcriptionService.engineDiagnostics
        transcriptionError = transcriptionService.lastError
    }

    func cancelRecording() {
        transcriptionService.cancelRecording()
        transcriptionState = transcriptionService.state
        transcriptionEngine = transcriptionService.selectedEngine
        availableTranscriptionEngines = transcriptionService.availableEngines
        transcriptionRecordingBackend = transcriptionService.recordingBackend
        transcriptionSupportsSnapshots = transcriptionService.supportsRecordingSnapshots
        transcriptionEngineDiagnostics = transcriptionService.engineDiagnostics
        transcriptionError = transcriptionService.lastError
    }

    func snapshotRecording() {
        guard transcriptionState == .recording else { return }
        let transcript = transcriptionService.snapshotRecording()
        transcriptionState = transcriptionService.state
        transcriptionEngine = transcriptionService.selectedEngine
        availableTranscriptionEngines = transcriptionService.availableEngines
        transcriptionRecordingBackend = transcriptionService.recordingBackend
        transcriptionSupportsSnapshots = transcriptionService.supportsRecordingSnapshots
        transcriptionEngineDiagnostics = transcriptionService.engineDiagnostics
        transcriptionError = transcriptionService.lastError

        guard let transcript, transcript.isEmpty == false else { return }

        let item = ClipboardItem(
            type: .transcript,
            content: transcript,
            createdAt: Date(),
            source: .mac,
            wordCount: transcript.split(separator: " ").count
        )
        clipboardStore.insert(item)
        clipboardItems = clipboardStore.fetchRecent(limit: 400)
    }

    func deleteItem(id: Int64) {
        guard clipboardStore.supportsDelete else {
            safetyNotice = "Delete blocked by strict data-safety mode."
            return
        }
        clipboardStore.delete(id: id)
        clipboardItems = clipboardStore.fetchRecent(limit: 400)
    }

    func openClipboardHistoryWindow() {
        safetyNotice = nil
        windowRoutingService.show(.clipboardHistory, model: self)
    }

    func openCommandLauncherWindow() {
        safetyNotice = nil
        windowRoutingService.show(.commandLauncher, model: self)
    }

    func filteredClipboardItems() -> [ClipboardItem] {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        return clipboardItems.filter { item in
            let typeMatches = selectedTypeFilter == nil || item.type == selectedTypeFilter
            let queryMatches: Bool

            if query.isEmpty {
                queryMatches = true
            } else {
                let body = item.content?.lowercased() ?? ""
                queryMatches = body.contains(query)
            }

            return typeMatches && queryMatches
        }
    }

    func audioInputs() -> [AudioInputDevice] {
        audioDeviceService.currentInputDevices()
    }

    private func wireHotkeys() {
        hotkeyService.setHandler(for: .transcription) { [weak self] in
            self?.toggleRecording()
        }

        hotkeyService.setHandler(for: .clipboardHistory) { [weak self] in
            self?.openClipboardHistoryWindow()
        }

        hotkeyService.setHandler(for: .commandLauncher) { [weak self] in
            self?.openCommandLauncherWindow()
        }

        hotkeyService.setHandler(for: .screenshot) { [weak self] in
            self?.safetyNotice = "Screenshot hotkey captured. Native capture flow is next."
        }

        hotkeyService.setHandler(for: .continuousContext) { [weak self] in
            self?.safetyNotice = "Continuous context hotkey captured. Session mode is next."
        }

        hotkeyService.startListening()
    }

    private func runSafetyAudit() {
        let report = safetyAuditor.audit(
            policy: safetyManager.currentPolicy(),
            paths: safetyManager.dataPaths(),
            clipboardStore: clipboardStore,
            syncService: syncService
        )
        safetyAuditSummary = report.summaryLine
    }
}
