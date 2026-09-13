import Foundation

enum SpeechEngineState: Equatable, Sendable {
    case notDownloaded
    case checking
    case downloading(progress: Double)
    case preparing
    case ready
    case failed(String)
}

@MainActor
protocol SpeechTranscriptionEngine: AnyObject {
    /// Stable implementation/model identity included in runtime evidence.
    var runtimeIdentity: String { get }
    var state: SpeechEngineState { get }
    /// Fired when readiness changes. RecorderController uses this to warm a
    /// verified local runtime and resume engine-bound queued recordings.
    var onStateChange: (() -> Void)? { get set }

    func ensureDownloaded()
    /// Prepares already-local assets for inference. This must never download.
    func prepare() async throws
    /// Stops this engine's preparation waiter without deleting local assets.
    func cancelPreparation()
    func transcribe(audioURL: URL) async throws -> String
    func transcribe(audioURL: URL, progress: @escaping @MainActor @Sendable (Double) -> Void) async throws -> String
}

extension SpeechTranscriptionEngine {
    func transcribe(audioURL: URL, progress: @escaping @MainActor @Sendable (Double) -> Void) async throws -> String {
        let text = try await transcribe(audioURL: audioURL)
        progress(1)
        return text
    }
}

struct SpeechTranscriptionEngineError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@MainActor
final class ParakeetSpeechTranscriptionEngine: SpeechTranscriptionEngine {
    let runtimeIdentity = ParakeetModelManager.identity
    let models: ParakeetModelManager
    let service: ParakeetService
    var onStateChange: (() -> Void)?

    private enum RuntimeState {
        case unloaded
        case preparing
        case ready
        case failed(String)
    }

    private var runtimeState = RuntimeState.unloaded
    private var preparationTask: Task<Void, Error>?
    private var preparationGeneration = UUID()

    var state: SpeechEngineState {
        switch models.state {
        case .notDownloaded: return .notDownloaded
        case .checking: return .checking
        case .downloading(let progress): return .downloading(progress: progress)
        case .preparing: return .preparing
        case .ready:
            switch runtimeState {
            case .unloaded, .preparing: return .preparing
            case .ready: return .ready
            case .failed(let message): return .failed(message)
            }
        case .failed(let message): return .failed(message)
        }
    }

    init(models: ParakeetModelManager, service: ParakeetService) {
        self.models = models
        self.service = service
        models.onReady = { [weak self] in
            guard let self else { return }
            if case .ready = runtimeState { return }
            runtimeState = .unloaded
            onStateChange?()
        }
    }

    convenience init() {
        self.init(models: ParakeetModelManager(), service: ParakeetService())
    }

    /// Called only through RecorderController.downloadSpeechEngine().
    func ensureDownloaded() {
        if case .ready = models.state {
            // Retry a failed local Core ML preparation without transferring the
            // already verified model assets again.
            runtimeState = .unloaded
            onStateChange?()
        } else if case .failed = models.state {
            models.retryDownload()
        } else {
            models.download()
        }
    }

    func prepare() async throws {
        await models.waitForCurrentOperation()
        guard let modelDirectory = models.readyModelDirectory else {
            throw SpeechTranscriptionEngineError(
                message: "Parakeet is not ready. Download and verify it in Settings."
            )
        }
        if case .ready = runtimeState { return }
        if let preparationTask {
            try await preparationTask.value
            return
        }

        runtimeState = .preparing
        onStateChange?()
        let generation = UUID()
        preparationGeneration = generation
        let service = service
        let task = Task {
            _ = try await service.prepare(modelDirectory: modelDirectory)
        }
        preparationTask = task
        do {
            try await task.value
            guard preparationGeneration == generation else { throw CancellationError() }
            preparationTask = nil
            runtimeState = .ready
            onStateChange?()
        } catch is CancellationError {
            if preparationGeneration == generation {
                preparationTask = nil
                runtimeState = .unloaded
                onStateChange?()
            }
            throw CancellationError()
        } catch {
            guard preparationGeneration == generation else { throw CancellationError() }
            preparationTask = nil
            let message = "Parakeet could not be prepared offline. Retry preparation. \(error.localizedDescription)"
            runtimeState = .failed(message)
            onStateChange?()
            throw SpeechTranscriptionEngineError(message: message)
        }
    }

    func cancelPreparation() {
        preparationGeneration = UUID()
        preparationTask?.cancel()
        preparationTask = nil
        if case .preparing = runtimeState {
            runtimeState = .unloaded
            onStateChange?()
        }
    }

    func transcribe(audioURL: URL) async throws -> String {
        guard let modelDirectory = models.readyModelDirectory else {
            throw SpeechTranscriptionEngineError(
                message: "Parakeet is not ready. Download and verify it in Settings."
            )
        }
        return try await service.transcribe(audioURL: audioURL, modelDirectory: modelDirectory)
    }

    func transcribe(audioURL: URL, progress: @escaping @MainActor @Sendable (Double) -> Void) async throws -> String {
        guard let directory = models.readyModelDirectory else {
            throw SpeechTranscriptionEngineError(message: "Parakeet is not ready.")
        }
        return try await service.transcribe(audioURL: audioURL, modelDirectory: directory, progress: progress)
    }

    func unload() async {
        preparationGeneration = UUID()
        preparationTask?.cancel()
        preparationTask = nil
        await service.unload()
        runtimeState = .unloaded
        onStateChange?()
    }
}

struct VoiceTranscriptionMetrics: Codable, Equatable, Sendable {
    let sessionID: String
    let engineIdentity: String
    let segmentCount: Int
    let audioBytes: Int64
    let audioDurationMs: Int64
    /// Legacy field: true for the first inference by this engine during this
    /// RecorderController lifetime. It does not mean runtime loading happened
    /// on the inference path.
    let engineWasCold: Bool
    let isFirstTranscriptionForEngine: Bool?
    /// True when model/runtime preparation finished before inference timing
    /// began. Preparation stage timing is reported by the engine service.
    let runtimePreparedBeforeInference: Bool?
    let queueWaitMs: Int64?
    let inferenceMs: Int64
    let deliveryMs: Int64
    let stopToDeliveryMs: Int64?
    /// Nil for audio restored after relaunch because the original tap time was
    /// not retained; current-session recordings and benchmark fixtures have it.
    let stopToVisibleMs: Int64?
}
