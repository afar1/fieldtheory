import AVFoundation
import CoreML
import FluidAudio
import Foundation
import OSLog

struct ParakeetTranscriptionError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

enum ParakeetPreparationStage: String, Codable, Equatable, Sendable {
    case validatingAssets
    case loadingPreprocessor
    case loadingEncoder
    case loadingDecoder
    case loadingJoint
    case loadingVocabulary
    case assemblingRuntime
    case warmingInference
}

struct ParakeetPreparationStageTiming: Codable, Equatable, Sendable {
    let stage: ParakeetPreparationStage
    let durationMs: Int64
}

/// Content-free preparation evidence. It intentionally contains no recording,
/// transcript, or local path data.
struct ParakeetPreparationDiagnostics: Codable, Equatable, Sendable {
    enum Outcome: String, Codable, Equatable, Sendable { case ready, failed }

    let modelIdentity: String
    let outcome: Outcome
    let failedStage: ParakeetPreparationStage?
    let stageTimings: [ParakeetPreparationStageTiming]
    let totalMs: Int64
    let cacheHit: Bool
}

/// Internal seams keep lifecycle behavior testable without loading production assets.
struct ParakeetLoadedRuntime: @unchecked Sendable {
    let transcribe: @Sendable (URL) async throws -> String
    var transcribeWithProgress: (@Sendable (URL, @escaping @MainActor @Sendable (Double) -> Void) async throws -> String)?
    let cleanup: @Sendable () async -> Void

    init(
        transcribe: @escaping @Sendable (URL) async throws -> String,
        cleanup: @escaping @Sendable () async -> Void
    ) {
        let cleanupOnce = ParakeetRuntimeCleanup(operation: cleanup)
        self.transcribe = transcribe
        self.cleanup = { await cleanupOnce.run() }
    }
}

private actor ParakeetRuntimeCleanup {
    private var didRun = false
    private let operation: @Sendable () async -> Void

    init(operation: @escaping @Sendable () async -> Void) {
        self.operation = operation
    }

    func run() async {
        guard !didRun else { return }
        didRun = true
        await operation()
    }
}

struct ParakeetLoadedRuntimeResult: @unchecked Sendable {
    let runtime: ParakeetLoadedRuntime
    let diagnostics: ParakeetPreparationDiagnostics
}

private struct ParakeetPreparationFailure: Error {
    let error: Error
    let diagnostics: ParakeetPreparationDiagnostics
}

/// A shared loader whose individual waiters can be cancelled immediately. Core
/// ML loading is not reliably cooperative, so waiter cancellation neither waits
/// for nor starts a duplicate underlying load.
private final class ParakeetPreparationFlight: @unchecked Sendable {
    let id = UUID()
    let directory: URL

    private let task: Task<ParakeetLoadedRuntimeResult, Error>
    private let lock = NSLock()
    private var result: Result<ParakeetLoadedRuntimeResult, Error>?
    private var waiters: [UUID: CheckedContinuation<ParakeetLoadedRuntimeResult, Error>] = [:]
    private var cancelledWaiters: Set<UUID> = []

    init(
        directory: URL,
        operation: @escaping @Sendable () async throws -> ParakeetLoadedRuntimeResult
    ) {
        self.directory = directory
        task = Task { try await operation() }
        Task { [task] in
            self.finish(await task.result)
        }
    }

    func value() async throws -> ParakeetLoadedRuntimeResult {
        let waiterID = UUID()
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                install(continuation, id: waiterID)
            }
        } onCancel: {
            cancelWaiter(id: waiterID)
        }
    }

    func invalidate() {
        task.cancel()
        lock.lock()
        if case .success(let loaded) = result {
            lock.unlock()
            Task { await loaded.runtime.cleanup() }
            return
        }
        guard result == nil else {
            lock.unlock()
            return
        }
        result = .failure(CancellationError())
        let continuations = Array(waiters.values)
        waiters.removeAll()
        cancelledWaiters.removeAll()
        lock.unlock()
        continuations.forEach { $0.resume(throwing: CancellationError()) }
    }

    private func install(
        _ continuation: CheckedContinuation<ParakeetLoadedRuntimeResult, Error>, id: UUID
    ) {
        lock.lock()
        if cancelledWaiters.remove(id) != nil {
            lock.unlock()
            continuation.resume(throwing: CancellationError())
        } else if let result {
            lock.unlock()
            continuation.resume(with: result)
        } else {
            waiters[id] = continuation
            lock.unlock()
        }
    }

    private func cancelWaiter(id: UUID) {
        lock.lock()
        if let continuation = waiters.removeValue(forKey: id) {
            lock.unlock()
            continuation.resume(throwing: CancellationError())
        } else if result == nil {
            cancelledWaiters.insert(id)
            lock.unlock()
        } else {
            lock.unlock()
        }
    }

    private func finish(_ newResult: Result<ParakeetLoadedRuntimeResult, Error>) {
        lock.lock()
        guard result == nil else {
            lock.unlock()
            if case .success(let loaded) = newResult {
                Task { await loaded.runtime.cleanup() }
            }
            return
        }
        result = newResult
        let continuations = Array(waiters.values)
        waiters.removeAll()
        cancelledWaiters.removeAll()
        lock.unlock()
        continuations.forEach { $0.resume(with: newResult) }
    }
}

/// FluidAudio exposes one progress session and re-enters its actor while Core ML
/// predicts. Keep all calls using the shared manager strictly serial.
private final class ParakeetInferenceGate: @unchecked Sendable {
    private final class Waiter: @unchecked Sendable {
        private let lock = NSLock()
        private var isCancelled = false

        func cancel() {
            lock.lock()
            isCancelled = true
            lock.unlock()
        }

        func canAcquire() -> Bool {
            lock.lock()
            defer { lock.unlock() }
            return !isCancelled
        }
    }

    private let lock = NSLock()
    private var isOccupied = false
    private var waiters: [(Waiter, CheckedContinuation<Void, Error>)] = []

    func acquire() async throws {
        let waiter = Waiter()
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            try await withCheckedThrowingContinuation {
                (continuation: CheckedContinuation<Void, Error>) in
                install(waiter, continuation: continuation)
            }
            if Task.isCancelled {
                release()
                throw CancellationError()
            }
        } onCancel: {
            cancel(waiter)
        }
    }

    private func install(
        _ waiter: Waiter, continuation: CheckedContinuation<Void, Error>
    ) {
        lock.lock()
        guard waiter.canAcquire() else {
            lock.unlock()
            continuation.resume(throwing: CancellationError())
            return
        }
        if !isOccupied {
            isOccupied = true
            lock.unlock()
            continuation.resume()
        } else {
            waiters.append((waiter, continuation))
            lock.unlock()
        }
    }

    private func cancel(_ waiter: Waiter) {
        waiter.cancel()
        lock.lock()
        if let index = waiters.firstIndex(where: { $0.0 === waiter }) {
            let continuation = waiters.remove(at: index).1
            lock.unlock()
            continuation.resume(throwing: CancellationError())
        } else {
            lock.unlock()
        }
    }

    func release() {
        lock.lock()
        while !waiters.isEmpty {
            let (waiter, continuation) = waiters.removeFirst()
            if waiter.canAcquire() {
                lock.unlock()
                continuation.resume()
                return
            }
            lock.unlock()
            continuation.resume(throwing: CancellationError())
            lock.lock()
        }
        isOccupied = false
        lock.unlock()
    }
}

/// Local-only Parakeet TDT v2 transcription. Model opening is manual and this
/// service never calls FluidAudio download or auto-recovery APIs.
actor ParakeetService {
    typealias RuntimeLoader = @Sendable (URL) async throws -> ParakeetLoadedRuntimeResult

    private var runtime: ParakeetLoadedRuntime?
    private var loadedModelDirectory: URL?
    private var preparationFlight: ParakeetPreparationFlight?
    private let runtimeLoader: RuntimeLoader?
    private let diagnosticsURL: URL?
    private var stageObserver: (@MainActor @Sendable (ParakeetPreparationStage) -> Void)?

    private func reportStage(_ stage: ParakeetPreparationStage) async {
        await stageObserver?(stage)
    }

    private let inferenceGate = ParakeetInferenceGate()
    private let logger = Logger(subsystem: "com.afar1.fieldtheory", category: "ParakeetService")
    private(set) var latestPreparationDiagnostics: ParakeetPreparationDiagnostics?

    nonisolated static var preparationDiagnosticsURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("VoiceDiagnostics", isDirectory: true)
            .appendingPathComponent("parakeet-preparation.json")
    }

    init() {
        runtimeLoader = nil
        diagnosticsURL = Self.preparationDiagnosticsURL
    }

    init(runtimeLoader: @escaping RuntimeLoader, diagnosticsURL: URL? = nil) {
        self.runtimeLoader = runtimeLoader
        self.diagnosticsURL = diagnosticsURL
    }

    /// Loads and runs one synthetic-silence prediction. Calls for the same
    /// directory share both the model load and prediction warmup.
    @discardableResult
    func prepare(modelDirectory: URL, onStage: (@MainActor @Sendable (ParakeetPreparationStage) -> Void)? = nil) async throws -> ParakeetPreparationDiagnostics {
        if let onStage { stageObserver = onStage }
        let (_, diagnostics, cacheHit) = try await ensureRuntime(modelDirectory: modelDirectory)
        if cacheHit {
            // Keep the full first-preparation report available on device rather
            // than replacing it with a zero-duration cache hit.
            return Self.cachedDiagnostics()
        }
        latestPreparationDiagnostics = diagnostics
        return diagnostics
    }

    /// Uses FluidAudio's disk-backed source so long recordings do not determine
    /// the in-memory PCM working set. It shares an in-progress cold preparation.
    func transcribe(audioURL: URL, modelDirectory: URL, progress: @escaping @MainActor @Sendable (Double) -> Void = { _ in }) async throws -> String {
        try Task.checkCancellation()
        guard FileManager.default.isReadableFile(atPath: audioURL.path) else {
            throw ParakeetTranscriptionError(message: "The saved recording could not be read.")
        }
        let (runtime, diagnostics, _) = try await ensureRuntime(modelDirectory: modelDirectory)
        latestPreparationDiagnostics = diagnostics
        try await inferenceGate.acquire()
        defer { inferenceGate.release() }
        if let transcribe = runtime.transcribeWithProgress {
            return try await transcribe(audioURL, progress)
        }
        return try await runtime.transcribe(audioURL)
    }

    /// Releases runtime memory without deleting downloaded models or recordings.
    /// It does not wait for non-cooperative Core ML loading to observe cancellation.
    func unload() async {
        let flight = preparationFlight
        preparationFlight = nil
        flight?.invalidate()

        let runtime = self.runtime
        self.runtime = nil
        loadedModelDirectory = nil
        await runtime?.cleanup()
    }

    private func ensureRuntime(
        modelDirectory: URL
    ) async throws -> (ParakeetLoadedRuntime, ParakeetPreparationDiagnostics, Bool) {
        let directory = modelDirectory.standardizedFileURL
        if let runtime, loadedModelDirectory == directory {
            return (runtime, latestPreparationDiagnostics ?? Self.cachedDiagnostics(), true)
        }

        if let flight = preparationFlight, flight.directory != directory {
            _ = try? await flight.value()
            try Task.checkCancellation()
            if preparationFlight?.id == flight.id { preparationFlight = nil }
        }

        if loadedModelDirectory != nil, loadedModelDirectory != directory {
            let oldRuntime = runtime
            runtime = nil
            loadedModelDirectory = nil
            await oldRuntime?.cleanup()
        }

        let flight: ParakeetPreparationFlight
        if let existing = preparationFlight, existing.directory == directory {
            flight = existing
        } else {
            let loader: RuntimeLoader = runtimeLoader ?? { [weak self] directory in
                try await Self.loadRuntime(from: directory, onStage: { stage in
                    await self?.reportStage(stage)
                })
            }
            flight = ParakeetPreparationFlight(directory: directory) {
                try await loader(directory)
            }
            preparationFlight = flight
        }

        do {
            let loaded = try await flight.value()
            try Task.checkCancellation()
            if preparationFlight?.id == flight.id {
                runtime = loaded.runtime
                loadedModelDirectory = directory
                preparationFlight = nil
                latestPreparationDiagnostics = loaded.diagnostics
                persist(loaded.diagnostics)
                return (loaded.runtime, loaded.diagnostics, false)
            }
            if let runtime, loadedModelDirectory == directory {
                return (runtime, loaded.diagnostics, false)
            }
            await loaded.runtime.cleanup()
            throw CancellationError()
        } catch is CancellationError {
            // A caller cancellation leaves the shared load available to later callers.
            throw CancellationError()
        } catch let failure as ParakeetPreparationFailure {
            if preparationFlight?.id == flight.id {
                preparationFlight = nil
                latestPreparationDiagnostics = failure.diagnostics
                persist(failure.diagnostics)
            }
            throw Self.publicError(for: failure.error)
        } catch {
            if preparationFlight?.id == flight.id { preparationFlight = nil }
            throw Self.publicError(for: error)
        }
    }

    private nonisolated static func loadRuntime(
        from directory: URL,
        onStage: @Sendable (ParakeetPreparationStage) async -> Void
    ) async throws -> ParakeetLoadedRuntimeResult {
        let clock = ContinuousClock()
        let totalStart = clock.now
        var timings: [ParakeetPreparationStageTiming] = []
        var currentStage = ParakeetPreparationStage.validatingAssets
        var stageStart = totalStart
        await onStage(currentStage)

        func finishStage() {
            timings.append(.init(
                stage: currentStage,
                durationMs: milliseconds(from: stageStart.duration(to: clock.now))))
        }

        do {
            guard PinnedParakeetAssets.haveExpectedSizes(
                in: directory, assets: PinnedParakeetAssets.v2English)
            else {
                throw ParakeetTranscriptionError(
                    message: "Parakeet is not ready. Download and verify it in Settings.")
            }
            finishStage()

            let frontendConfig = MLModelConfiguration()
            frontendConfig.computeUnits = .cpuOnly
            let inferenceConfig = MLModelConfiguration()
            inferenceConfig.computeUnits = .cpuAndNeuralEngine

            currentStage = .loadingPreprocessor
            await onStage(currentStage)
            stageStart = clock.now
            let preprocessor = try await MLModel.load(
                contentsOf: directory.appendingPathComponent("Preprocessor.mlmodelc"),
                configuration: frontendConfig)
            finishStage()
            try Task.checkCancellation()

            currentStage = .loadingEncoder
            await onStage(currentStage)
            stageStart = clock.now
            let encoder = try await MLModel.load(
                contentsOf: directory.appendingPathComponent("Encoder.mlmodelc"),
                configuration: inferenceConfig)
            finishStage()
            try Task.checkCancellation()

            currentStage = .loadingDecoder
            await onStage(currentStage)
            stageStart = clock.now
            let decoder = try await MLModel.load(
                contentsOf: directory.appendingPathComponent("Decoder.mlmodelc"),
                configuration: inferenceConfig)
            finishStage()
            try Task.checkCancellation()

            currentStage = .loadingJoint
            await onStage(currentStage)
            stageStart = clock.now
            let joint = try await MLModel.load(
                contentsOf: directory.appendingPathComponent("JointDecision.mlmodelc"),
                configuration: inferenceConfig)
            finishStage()
            try Task.checkCancellation()

            currentStage = .loadingVocabulary
            await onStage(currentStage)
            stageStart = clock.now
            let vocabulary = try loadVocabulary(
                from: directory.appendingPathComponent("parakeet_vocab.json"))
            finishStage()

            currentStage = .assemblingRuntime
            await onStage(currentStage)
            stageStart = clock.now
            let models = AsrModels(
                encoder: encoder,
                preprocessor: preprocessor,
                decoder: decoder,
                joint: joint,
                configuration: inferenceConfig,
                vocabulary: vocabulary,
                version: .v2)
            let manager = AsrManager(
                config: ASRConfig(
                    parallelChunkConcurrency: 1,
                    streamingEnabled: true,
                    streamingThreshold: 480_000),
                models: models)
            finishStage()

            // AsrManager.init warms allocation caches only. This content-free
            // minimum-duration prediction forces deferred Core ML compilation.
            currentStage = .warmingInference
            await onStage(currentStage)
            stageStart = clock.now
            var warmupState = try TdtDecoderState(decoderLayers: 2)
            _ = try await manager.transcribe(
                [Float](repeating: 0, count: ASRConstants.minimumRequiredSamples(
                    forSampleRate: ASRConstants.sampleRate)),
                decoderState: &warmupState)
            finishStage()
            try Task.checkCancellation()

            let transcribe: @Sendable (URL, @escaping @MainActor @Sendable (Double) -> Void) async throws -> String = { audioURL, progress in
                // FluidAudio only closes its progress stream for audio longer
                // than 240,000 converted samples. Cancelling a short-file
                // observer would leave a terminated stream for the next file.
                let audioFile = try AVAudioFile(forReading: audioURL)
                let emitsProgress = Double(audioFile.length) / audioFile.processingFormat.sampleRate > 15
                let stream = emitsProgress ? await manager.transcriptionProgressStream : nil
                let observer = stream.map { stream in
                    Task {
                        do {
                            for try await fraction in stream { await progress(fraction) }
                        } catch { /* Inference below owns error reporting. */ }
                    }
                }
                defer { observer?.cancel() }
                var decoderState = try TdtDecoderState(decoderLayers: 2)
                let result = try await manager.transcribeDiskBacked(audioURL, decoderState: &decoderState)
                try Task.checkCancellation()
                await progress(1)
                return result.text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }
            var runtime = ParakeetLoadedRuntime(
                transcribe: { audioURL in try await transcribe(audioURL, { _ in }) },
                cleanup: { await manager.cleanup() })
            runtime.transcribeWithProgress = transcribe
            return .init(
                runtime: runtime,
                diagnostics: .init(
                    modelIdentity: ParakeetModelManager.identity,
                    outcome: .ready,
                    failedStage: nil,
                    stageTimings: timings,
                    totalMs: milliseconds(from: totalStart.duration(to: clock.now)),
                    cacheHit: false))
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            finishStage()
            throw ParakeetPreparationFailure(
                error: error,
                diagnostics: .init(
                    modelIdentity: ParakeetModelManager.identity,
                    outcome: .failed,
                    failedStage: currentStage,
                    stageTimings: timings,
                    totalMs: milliseconds(from: totalStart.duration(to: clock.now)),
                    cacheHit: false))
        }
    }

    private nonisolated static func cachedDiagnostics() -> ParakeetPreparationDiagnostics {
        .init(
            modelIdentity: ParakeetModelManager.identity,
            outcome: .ready,
            failedStage: nil,
            stageTimings: [],
            totalMs: 0,
            cacheHit: true)
    }

    private nonisolated static func publicError(for error: Error) -> Error {
        if let error = error as? ParakeetTranscriptionError { return error }
        return ParakeetTranscriptionError(
            message: "The Parakeet model could not be prepared offline. Retry preparation. \(error.localizedDescription)")
    }

    private func persist(_ diagnostics: ParakeetPreparationDiagnostics) {
        guard let diagnosticsURL else { return }
        do {
            let directory = diagnosticsURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var mutableDirectory = directory
            try mutableDirectory.setResourceValues(values)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            var report = try JSONSerialization.jsonObject(with: encoder.encode(diagnostics)) as! [String: Any]
            report["recordedAt"] = ISO8601DateFormatter().string(from: Date())
            report["build"] = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
            try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
                .write(to: diagnosticsURL, options: .atomic)
        } catch {
            logger.error(
                "Parakeet preparation diagnostics could not be persisted: \(error.localizedDescription, privacy: .public)")
        }
    }

    private nonisolated static func milliseconds(from duration: Duration) -> Int64 {
        let components = duration.components
        let seconds = components.seconds.multipliedReportingOverflow(by: 1_000)
        guard !seconds.overflow else { return Int64.max }
        return seconds.partialValue + components.attoseconds / 1_000_000_000_000_000
    }

    private nonisolated static func loadVocabulary(from url: URL) throws -> [Int: String] {
        let data = try Data(contentsOf: url)
        guard let values = try JSONSerialization.jsonObject(with: data) as? [String: String] else {
            throw ParakeetTranscriptionError(message: "The Parakeet vocabulary is invalid.")
        }
        let vocabulary = Dictionary(uniqueKeysWithValues: values.compactMap { key, value in
            Int(key).map { ($0, value) }
        })
        guard !vocabulary.isEmpty else {
            throw ParakeetTranscriptionError(message: "The Parakeet vocabulary is empty.")
        }
        return vocabulary
    }
}
