import Foundation

@MainActor
final class DefaultTranscriptionService: TranscriptionService {
    private let defaults = UserDefaults.standard
    private let engineKey = "fieldTheoryNative.transcription.engine"

    private(set) var state: TranscriptionState = .idle
    private(set) var selectedEngine: TranscriptionEngineKind = .whisper
    private(set) var availableEngines: [TranscriptionEngineKind] = []
    private(set) var recordingBackend: TranscriptionRecordingBackendKind = .avAudioRecorder
    private(set) var supportsRecordingSnapshots: Bool = false
    private(set) var engineDiagnostics: [TranscriptionEngineDiagnostic] = []
    private(set) var lastError: String?

    private let safetyManager: DataSafetyManager
    private let context: TranscriptionContext
    private let recorder: RecordingController
    private let engines: [TranscriptionEngineKind: TranscriptionEngine]
    private let diagnosticsProvider: TranscriptionDiagnosticsProvider
    private let fileManager: FileManager
    private let diagnosticsQueue = DispatchQueue(label: "FieldTheoryNative.TranscriptionDiagnostics", qos: .utility)
    private var diagnosticsGeneration: UInt64 = 0
    private var recordingURL: URL?

    init(
        safetyManager: DataSafetyManager = DataSafetyManager(),
        recorder: RecordingController? = nil,
        modelLocator: ModelLocator? = nil,
        engines: [TranscriptionEngine]? = nil,
        diagnosticsProvider: TranscriptionDiagnosticsProvider = TranscriptionDiagnosticsProvider(),
        fileManager: FileManager = .default
    ) {
        self.safetyManager = safetyManager
        self.fileManager = fileManager
        self.diagnosticsProvider = diagnosticsProvider

        let paths = safetyManager.dataPaths()
        let resolvedLocator = modelLocator ?? DefaultModelLocator(paths: paths)
        self.context = TranscriptionContext(dataPaths: paths, modelLocator: resolvedLocator)

        let resolvedRecorder = recorder ?? Self.makeDefaultRecorder(modelLocator: resolvedLocator)
        self.recorder = resolvedRecorder
        self.recordingBackend = resolvedRecorder.backend
        self.supportsRecordingSnapshots = resolvedRecorder.supportsSnapshots

        let resolvedEngines = engines ?? [
            WhisperCLITranscriptionEngine(),
            QwenScriptTranscriptionEngine(),
        ]
        self.engines = Dictionary(uniqueKeysWithValues: resolvedEngines.map { ($0.kind, $0) })

        refreshAvailableEngines()
        loadPersistedEngineSelection()
        refreshDiagnostics()
    }

    func setSelectedEngine(_ engine: TranscriptionEngineKind) {
        selectedEngine = engine
        defaults.set(engine.rawValue, forKey: engineKey)
        refreshAvailableEngines()
        refreshDiagnostics()
    }

    func startRecording() {
        guard state == .idle else { return }

        do {
            try safetyManager.ensureSafeFilesystemLayout()
            let targetURL = makeRecordingURL()
            recordingURL = targetURL

            let harvestMode: RecordingHarvestMode = recorder.backend == .helper ? .command : .off
            try recorder.setHarvestMode(harvestMode)
            try recorder.startRecording(preferredOutputURL: targetURL)
            state = .recording
            lastError = nil
        } catch {
            lastError = error.localizedDescription
            state = .idle
            recordingURL = nil
        }
    }

    func cancelRecording() {
        guard state == .recording else { return }
        do {
            try recorder.cancelRecording()
            _ = recorder.drainReadyChunks()
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
        state = .idle
        recordingURL = nil
    }

    func snapshotRecording() -> String? {
        guard state == .recording else { return nil }
        guard recorder.supportsSnapshots else {
            lastError = "Snapshot recording is unsupported for active backend."
            return nil
        }

        let chosenEngine: TranscriptionEngine
        let chosenKind: TranscriptionEngineKind
        do {
            let resolved = try resolveEngineForTranscription()
            chosenKind = resolved.kind
            chosenEngine = resolved.engine
        } catch {
            lastError = error.localizedDescription
            refreshDiagnostics()
            return nil
        }

        do {
            let snapshotURL = try recorder.snapshotRecording()
            let nativeURL = try persistedRecordingURL(
                from: snapshotURL,
                preferredURL: makeRecordingURL(prefix: "recording-snapshot")
            )
            let text = try chosenEngine.transcribe(audioURL: nativeURL, context: context)
            guard text.isEmpty == false else {
                throw TranscriptionEngineError.emptyTranscript("Snapshot transcript is empty.")
            }

            selectedEngine = chosenKind
            defaults.set(chosenKind.rawValue, forKey: engineKey)
            lastError = nil
            refreshDiagnostics()
            return text
        } catch {
            lastError = error.localizedDescription
            refreshDiagnostics()
            return nil
        }
    }

    func stopRecording() -> String? {
        guard state == .recording else { return nil }
        state = .transcribing

        defer {
            state = .idle
            recordingURL = nil
        }

        guard let preferredRecordingURL = recordingURL else {
            lastError = "No active recording file."
            return nil
        }

        let allRecordingURLs: [URL]
        do {
            let recorderOutputURL = try recorder.stopRecording()
            var drainedChunks = recorder.drainReadyChunks()
            drainedChunks.append(contentsOf: recorder.drainReadyChunks())
            drainedChunks = uniqueURLs(drainedChunks)
            let finalURL = try persistedRecordingURL(
                from: recorderOutputURL,
                preferredURL: preferredRecordingURL
            )
            let chunkURLs = try drainedChunks.map { chunkURL in
                try persistedRecordingURL(
                    from: chunkURL,
                    preferredURL: makeRecordingURL(prefix: "recording-chunk")
                )
            }
            allRecordingURLs = chunkURLs + [finalURL]
        } catch {
            lastError = error.localizedDescription
            return nil
        }

        let chosenEngine: TranscriptionEngine
        let chosenKind: TranscriptionEngineKind
        do {
            let resolved = try resolveEngineForTranscription()
            chosenKind = resolved.kind
            chosenEngine = resolved.engine
        } catch {
            lastError = error.localizedDescription
            refreshDiagnostics()
            return nil
        }

        do {
            var transcriptParts: [String] = []
            var firstChunkError: Error?

            for audioURL in allRecordingURLs {
                do {
                    let text = try chosenEngine.transcribe(audioURL: audioURL, context: context)
                    if text.isEmpty == false {
                        transcriptParts.append(text)
                    }
                } catch {
                    if firstChunkError == nil {
                        firstChunkError = error
                    }
                }
            }

            if transcriptParts.isEmpty {
                if let firstChunkError {
                    throw firstChunkError
                }
                throw TranscriptionEngineError.emptyTranscript("Transcription returned empty output.")
            }

            if let firstChunkError {
                lastError = "Partial transcript generated: \(firstChunkError.localizedDescription)"
            } else {
                lastError = nil
            }

            selectedEngine = chosenKind
            defaults.set(chosenKind.rawValue, forKey: engineKey)
            refreshDiagnostics()
            return transcriptParts.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            lastError = error.localizedDescription
            refreshDiagnostics()
            return nil
        }
    }

    private func uniqueURLs(_ input: [URL]) -> [URL] {
        var seen: Set<String> = []
        var output: [URL] = []
        output.reserveCapacity(input.count)
        for url in input {
            let key = url.standardizedFileURL.path
            if seen.contains(key) {
                continue
            }
            seen.insert(key)
            output.append(url)
        }
        return output
    }

    private func resolveEngineForTranscription() throws -> (kind: TranscriptionEngineKind, engine: TranscriptionEngine) {
        refreshAvailableEngines()
        guard let chosen = resolveEngine(), let engine = engines[chosen] else {
            throw TranscriptionEngineError.processFailed("No transcription engine available.")
        }
        return (chosen, engine)
    }

    private func resolveEngine() -> TranscriptionEngineKind? {
        if availableEngines.contains(selectedEngine) {
            return selectedEngine
        }

        if let whisper = availableEngines.first(where: { $0 == .whisper }) {
            return whisper
        }

        return availableEngines.first
    }

    private func refreshAvailableEngines() {
        availableEngines = TranscriptionEngineKind.allCases.filter { kind in
            guard let engine = engines[kind] else { return false }
            return engine.isAvailable(context: context)
        }
    }

    private func refreshDiagnostics() {
        diagnosticsGeneration &+= 1
        let generation = diagnosticsGeneration
        let snapshotContext = context
        let snapshotEngines = availableEngines
        let provider = diagnosticsProvider

        diagnosticsQueue.async { [weak self] in
            let diagnostics = provider.diagnostics(
                context: snapshotContext,
                availableEngines: snapshotEngines
            )

            Task { @MainActor [weak self] in
                guard let self else { return }
                guard self.diagnosticsGeneration == generation else { return }
                self.engineDiagnostics = diagnostics
            }
        }
    }

    private func loadPersistedEngineSelection() {
        guard let raw = defaults.string(forKey: engineKey), let persisted = TranscriptionEngineKind(rawValue: raw) else {
            if availableEngines.contains(.whisper) {
                selectedEngine = .whisper
            } else if let first = availableEngines.first {
                selectedEngine = first
            }
            return
        }

        if availableEngines.contains(persisted) {
            selectedEngine = persisted
        } else if availableEngines.contains(.whisper) {
            selectedEngine = .whisper
        } else if let first = availableEngines.first {
            selectedEngine = first
        } else {
            selectedEngine = persisted
        }
    }

    private func makeRecordingURL(prefix: String = "recording") -> URL {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss-SSS"
        let fileName = "\(prefix)-\(formatter.string(from: Date())).wav"
        return context.dataPaths.recordingsRoot.appendingPathComponent(fileName, isDirectory: false)
    }

    private func persistedRecordingURL(from sourceURL: URL, preferredURL: URL) throws -> URL {
        guard fileManager.fileExists(atPath: sourceURL.path) else {
            throw TranscriptionEngineError.recordingFailed("Recording output not found at \(sourceURL.path).")
        }

        if sourceURL.standardizedFileURL == preferredURL.standardizedFileURL {
            return sourceURL
        }

        let destinationURL = uniqueRecordingURL(startingWith: preferredURL)
        try fileManager.copyItem(at: sourceURL, to: destinationURL)
        return destinationURL
    }

    private func uniqueRecordingURL(startingWith preferredURL: URL) -> URL {
        if fileManager.fileExists(atPath: preferredURL.path) == false {
            return preferredURL
        }

        let ext = preferredURL.pathExtension
        let baseName = preferredURL.deletingPathExtension().lastPathComponent
        let directory = preferredURL.deletingLastPathComponent()
        let suffix = String(UUID().uuidString.prefix(8)).lowercased()
        let candidateName = "\(baseName)-\(suffix)"
        if ext.isEmpty {
            return directory.appendingPathComponent(candidateName, isDirectory: false)
        }
        return directory.appendingPathComponent(candidateName).appendingPathExtension(ext)
    }

    private static func makeDefaultRecorder(modelLocator: ModelLocator) -> RecordingController {
        guard let helperURL = modelLocator.helperBinaryURL() else {
            return AVAudioRecordingController()
        }

        do {
            return try HelperRecordingController(helperExecutableURL: helperURL)
        } catch {
            return AVAudioRecordingController()
        }
    }
}
