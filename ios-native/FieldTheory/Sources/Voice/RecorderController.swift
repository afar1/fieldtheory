import AVFoundation
import Foundation
import Observation
import os
import UIKit

enum RecordingFinishAction: String {
    case stop, send
}

enum RecorderPhase: Equatable {
    case idle
    case recording
    case transcribing
}

struct PendingAudioSession: Equatable, Identifiable {
    let id: String
    let files: [URL]
}

private struct PendingAudioEngineBinding: Codable {
    let schemaVersion: Int
    let engine: String
}

/// Records 16 kHz mono WAV with the audio background mode keeping the
/// session alive while the screen is locked. Call interruptions finalize the
/// current segment and auto-resume into a new one when the system hands the
/// mic back, so one tap can capture an arbitrarily long session.
@MainActor
@Observable
final class RecorderController {
    private(set) var phase: RecorderPhase = .idle
    private(set) var startedAt: Date?
    private(set) var level: Float = 0 // 0...1 for the waveform
    private(set) var elapsed: TimeInterval = 0
    private(set) var pendingSessionCount = 0
    private(set) var nextPendingSession: PendingAudioSession?
    var lastError: String?

    private var lastStartFailure: Error?
    private var recorder: AVAudioRecorder?
    private var segmentURLs: [URL] = []
    private var sessionId: Int64 = 0
    private var meterTimer: Timer?
    private var interruptionObserver: NSObjectProtocol?
    private var draining = false
    private var transcriptionProgress: Progress?
    private var userTranscriptionPending = false
    private var progressCompletedFiles = 0
    private var progressTotalFiles = 1
    private let continuedProcessing: VoiceContinuedProcessing
    private var workEnabled = false
    private var workGeneration = UUID()
    private var deliveryTask: Task<Bool, Never>?
    private var deliveryFiles: [URL] = []
    private var deliveryBindingURL: URL?
    private let speechEngine: any SpeechTranscriptionEngine
    private var enginePreparationTask: Task<Void, Never>?
    private var enginePreparationToken: UUID?
    private var engineStateRevision = 0
    private var stoppedAtMsBySessionID: [String: Int64] = [:]
    private var pendingVisibility: [String: (stoppedAtMs: Int64, metrics: VoiceTranscriptionMetrics)] = [:]
    private var deliverySessionByTranscriptID: [String: String] = [:]
    private var earlyVisibilityByTranscriptID: [String: Int64] = [:]
    private var earlyVisibilityBySessionID: [String: Int64] = [:]
    private var usedEngineIdentities = Set<String>()
    private let pendingDirectory: URL
    private let metricsDirectory: URL
    private let defaults: UserDefaults
    private let transcribeOverride: ((URL) async throws -> String)?
    private static let cleanupKey = "voice-recording-cleanup-required"
    private var backgroundTasks = Set<UIBackgroundTaskIdentifier>()
    private let logger = Logger(subsystem: "com.afar1.fieldtheory", category: "Voice")

    /// Set by the app: receives the final transcript text for routing
    /// (insert at cursor vs. save to Voice).
    /// Returns true only after the destination accepted the transcript. Raw
    /// audio stays queued when local persistence fails.
    var replaceWords: ((String) -> String)?
    var onTranscript: ((String) async -> Bool)?
    /// Lightweight status line for toasts (queued audio, errors).
    var onCaptureCancelled: (() -> Void)?
    var onCaptureStarted: (() -> Void)?
    var onCaptureStopped: (() -> Void)?
    var onCaptureFinished: (() -> Void)?
    var onNotice: ((String, String) -> Void)?
    /// Bounded, content-free evidence for device inference and delivery tests.
    var onTranscriptionMetrics: ((VoiceTranscriptionMetrics) -> Void)?

    private(set) var lastTranscriptionMetrics: VoiceTranscriptionMetrics?
    /// Non-nil only while onTranscript is persisting this recording. The UI
    /// can associate it with the new transcript ID and later mark row display.
    private(set) var lastTranscribedSessionID: String?
    private(set) var currentDeliverySessionID: String?

    var engineIdentity: String { speechEngine.runtimeIdentity }

    var engineState: SpeechEngineState {
        _ = engineStateRevision
        return speechEngine.state
    }

    /// Recordings waiting for the model; survives relaunches.
    nonisolated static var pendingAudioDir: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("pending-audio", isDirectory: true)
    }

    /// Content-free latest-sample output that can be retrieved from a physical
    /// device without reading transcripts or unified logs.
    nonisolated static var voiceDiagnosticsDir: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("VoiceDiagnostics", isDirectory: true)
    }

    nonisolated static var latestMetricsURL: URL {
        voiceDiagnosticsDir.appendingPathComponent("latest.json")
    }

    nonisolated static var metricsHistoryURL: URL {
        voiceDiagnosticsDir.appendingPathComponent("history.json")
    }

    init(pendingDirectory: URL = RecorderController.pendingAudioDir,
         metricsDirectory: URL = RecorderController.voiceDiagnosticsDir,
         defaults: UserDefaults = .standard,
         transcribe: ((URL) async throws -> String)? = nil,
         speechEngine: (any SpeechTranscriptionEngine)? = nil,
         continuedProcessing: VoiceContinuedProcessing? = nil) {
        self.continuedProcessing = continuedProcessing ?? .shared
        self.pendingDirectory = pendingDirectory
        self.metricsDirectory = metricsDirectory
        self.defaults = defaults
        self.transcribeOverride = transcribe
        self.speechEngine = speechEngine ?? ParakeetSpeechTranscriptionEngine()
        if FileManager.default.fileExists(atPath: pendingDirectory.path) {
            do {
                try excludePendingDirectoryFromBackup()
            } catch {
                lastError = "Saved recordings could not be protected from device backup: \(error.localizedDescription)"
            }
            do {
                try migratePendingAudioToParakeet()
            } catch {
                lastError = "Saved recordings remain queued but their Parakeet marker could not be updated: \(error.localizedDescription)"
            }
        }
        refreshPendingAudioStatus()
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in self?.handleInterruption(notification) }
        }
        wireEngineStateCallback()
    }

    var isRecording: Bool { phase == .recording }

    /// The Settings Download/Retry action is the only Parakeet download entry.
    func downloadSpeechEngine() { speechEngine.ensureDownloaded() }

    /// Called by a transcript row's onAppear hook. Delivery metrics are emitted
    /// first; this emits an updated sample with the actual rendered boundary.
    func markTranscriptVisible(sessionID: String) {
        recordVisibility(sessionID: sessionID, visibleAtMs: Timestamps.nowMs())
    }

    private func recordVisibility(sessionID: String, visibleAtMs: Int64) {
        guard let pending = pendingVisibility.removeValue(forKey: sessionID) else {
            if earlyVisibilityBySessionID.count >= 32, let first = earlyVisibilityBySessionID.keys.first {
                earlyVisibilityBySessionID.removeValue(forKey: first)
            }
            earlyVisibilityBySessionID[sessionID] = visibleAtMs
            return
        }
        let metrics = pending.metrics
        let updated = VoiceTranscriptionMetrics(
            sessionID: metrics.sessionID,
            engineIdentity: metrics.engineIdentity,
            segmentCount: metrics.segmentCount,
            audioBytes: metrics.audioBytes,
            audioDurationMs: metrics.audioDurationMs,
            engineWasCold: metrics.engineWasCold,
            isFirstTranscriptionForEngine: metrics.isFirstTranscriptionForEngine,
            runtimePreparedBeforeInference: metrics.runtimePreparedBeforeInference,
            queueWaitMs: metrics.queueWaitMs,
            inferenceMs: metrics.inferenceMs,
            deliveryMs: metrics.deliveryMs,
            stopToDeliveryMs: metrics.stopToDeliveryMs,
            stopToVisibleMs: max(0, visibleAtMs - pending.stoppedAtMs)
        )
        publishMetrics(updated)
        logger.info("Voice transcript rendered session=\(sessionID, privacy: .public) stop_to_visible_ms=\(updated.stopToVisibleMs ?? -1, privacy: .public)")
    }

    /// RootView calls this immediately after TranscriptStore.add succeeds.
    func associateCurrentDelivery(transcriptID: String) {
        guard let sessionID = currentDeliverySessionID else { return }
        if let visibleAtMs = earlyVisibilityByTranscriptID.removeValue(forKey: transcriptID) {
            recordVisibility(sessionID: sessionID, visibleAtMs: visibleAtMs)
            return
        }
        if deliverySessionByTranscriptID.count >= 32, let first = deliverySessionByTranscriptID.keys.first {
            deliverySessionByTranscriptID.removeValue(forKey: first)
        }
        deliverySessionByTranscriptID[transcriptID] = sessionID
    }

    /// VoiceView calls this from the persisted transcript row's onAppear.
    func markTranscriptVisible(transcriptID: String) {
        let visibleAtMs = Timestamps.nowMs()
        if let sessionID = deliverySessionByTranscriptID.removeValue(forKey: transcriptID) {
            recordVisibility(sessionID: sessionID, visibleAtMs: visibleAtMs)
        } else {
            if earlyVisibilityByTranscriptID.count >= 32, let first = earlyVisibilityByTranscriptID.keys.first {
                earlyVisibilityByTranscriptID.removeValue(forKey: first)
            }
            earlyVisibilityByTranscriptID[transcriptID] = visibleAtMs
        }
    }

    func lastTranscriptionMetricsJSON() throws -> Data {
        guard let lastTranscriptionMetrics else {
            throw SpeechTranscriptionEngineError(message: "No transcription metrics are available yet")
        }
        return try Self.encodeMetrics(lastTranscriptionMetrics)
    }

    private nonisolated static func encodeMetrics(_ metrics: VoiceTranscriptionMetrics) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(metrics)
    }

    private nonisolated static func encodeMetricsHistory(_ metrics: [VoiceTranscriptionMetrics]) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(metrics)
    }

    private func publishMetrics(_ metrics: VoiceTranscriptionMetrics) {
        lastTranscriptionMetrics = metrics
        do {
            try FileManager.default.createDirectory(at: metricsDirectory, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var directory = metricsDirectory
            try directory.setResourceValues(values)
            try Self.encodeMetrics(metrics).write(
                to: metricsDirectory.appendingPathComponent("latest.json"),
                options: .atomic
            )
            let historyURL = metricsDirectory.appendingPathComponent("history.json")
            var history = (try? Data(contentsOf: historyURL))
                .flatMap { try? JSONDecoder().decode([VoiceTranscriptionMetrics].self, from: $0) }
                ?? []
            history.append(metrics)
            history = Array(history.suffix(20))
            try Self.encodeMetricsHistory(history).write(to: historyURL, options: .atomic)
        } catch {
            logger.error("Voice diagnostics could not be persisted: \(error.localizedDescription, privacy: .public)")
        }
        onTranscriptionMetrics?(metrics)
    }

    private func wireEngineStateCallback() {
        speechEngine.onStateChange = { [weak self] in
            guard let self else { return }
            engineStateRevision &+= 1
            requestPreparationIfNeeded()
            if case .ready = speechEngine.state {
                Task { await self.resumePendingWork() }
            } else if case .failed(let message) = speechEngine.state,
                      !Self.pendingSessions(in: pendingDirectory).isEmpty {
                lastError = "Voice model preparation failed: \(message)"
            }
        }
    }

    private func requestPreparationIfNeeded() {
        guard workEnabled else { return }
        guard enginePreparationTask == nil else { return }
        switch speechEngine.state {
        case .checking, .preparing:
            break
        case .notDownloaded, .downloading, .ready, .failed:
            return
        }

        let generation = workGeneration
        let token = UUID()
        let task = Task { @MainActor [weak self] in
            guard let engine = self?.speechEngine else { return }
            do {
                try await engine.prepare()
            } catch is CancellationError {
                // Audio remains durable. A later state change or explicit
                // resume can join a still-running service preparation.
            } catch {
                guard let self, workEnabled, workGeneration == generation,
                      enginePreparationToken == token else { return }
                lastError = "Voice model preparation failed: \(error.localizedDescription)"
                if !Self.pendingSessions(in: pendingDirectory).isEmpty {
                    onNotice?("Saved — retry voice model preparation", "clock.arrow.circlepath")
                }
            }
            guard let self, workEnabled, workGeneration == generation,
                  enginePreparationToken == token else { return }
            enginePreparationTask = nil
            enginePreparationToken = nil
            if case .ready = speechEngine.state { await resumePendingWork() }
        }
        enginePreparationToken = token
        enginePreparationTask = task
    }

    private func cancelPreparationWaiters() {
        enginePreparationTask?.cancel()
        enginePreparationTask = nil
        enginePreparationToken = nil
        speechEngine.cancelPreparation()
    }

    /// Offline identity is sufficient; explicit sign-out disables all work.
    /// A persisted cleanup marker makes an interrupted/failed sign-out fail closed.
    func setWorkEnabled(_ enabled: Bool) {
        guard enabled else {
            workEnabled = false
            workGeneration = UUID()
            cancelPreparationWaiters()
            return
        }
        if defaults.bool(forKey: Self.cleanupKey) {
            do {
                try removeRecordingFiles()
                defaults.removeObject(forKey: Self.cleanupKey)
                refreshPendingAudioStatus()
            } catch {
                lastError = "Could not remove signed-out recordings. Please try signing in again."
                return
            }
        }
        workEnabled = true
        requestPreparationIfNeeded()
    }

    /// Stops pending delivery at the next safe boundary without deleting its
    /// audio. Used while entering an isolated reviewer session: any delivery
    /// already inside the production callback settles before AppModel swaps
    /// stores, and queued production recordings remain available afterward.
    func suspendAndWait() async {
        workEnabled = false
        workGeneration = UUID()
        cancelPreparationWaiters()
        if let deliveryTask {
            let delivered = await deliveryTask.value
            if delivered {
                for url in deliveryFiles where FileManager.default.fileExists(atPath: url.path) {
                    try? FileManager.default.removeItem(at: url)
                }
                if let deliveryBindingURL { try? FileManager.default.removeItem(at: deliveryBindingURL) }
            }
        }
        deliveryTask = nil
        deliveryFiles = []
        deliveryBindingURL = nil
        draining = false
        if phase == .transcribing { phase = .idle }
        refreshPendingAudioStatus()
    }

    /// Stop capture immediately, invalidate every suspended completion, then
    /// settle any delivery already in progress before AppModel wipes its stores.
    func discardRecordings() async throws {
        defaults.removeObject(forKey: Self.finishActionsKey)
        onCaptureCancelled?()
        workEnabled = false
        workGeneration = UUID()
        cancelPreparationWaiters()
        defaults.set(true, forKey: Self.cleanupKey)
        meterTimer?.invalidate()
        meterTimer = nil
        recorder?.stop()
        recorder = nil
        phase = .idle
        startedAt = nil
        level = 0
        elapsed = 0
        draining = false
        for task in Array(backgroundTasks) { finishBackgroundTask(task) }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        _ = await deliveryTask?.value
        deliveryTask = nil
        deliveryFiles = []
        deliveryBindingURL = nil
        currentDeliverySessionID = nil
        stoppedAtMsBySessionID.removeAll()
        pendingVisibility.removeAll()
        deliverySessionByTranscriptID.removeAll()
        earlyVisibilityByTranscriptID.removeAll()
        earlyVisibilityBySessionID.removeAll()
        usedEngineIdentities.removeAll()
        lastTranscriptionMetrics = nil
        try? FileManager.default.removeItem(at: metricsDirectory.appendingPathComponent("latest.json"))
        try? FileManager.default.removeItem(at: metricsDirectory.appendingPathComponent("history.json"))
        try removeRecordingFiles()
        segmentURLs = []
        defaults.removeObject(forKey: Self.cleanupKey)
        lastError = nil
        refreshPendingAudioStatus()
    }

    private func removeRecordingFiles() throws {
        let files = FileManager.default
        if files.fileExists(atPath: pendingDirectory.path) {
            try files.removeItem(at: pendingDirectory)
        }
        for url in segmentURLs where files.fileExists(atPath: url.path) {
            try files.removeItem(at: url)
        }
    }

    private static let finishActionsKey = "ft-recording-finish-actions"

    func finishAction(for sessionID: String?) -> RecordingFinishAction? {
        guard let sessionID,
              let value = defaults.dictionary(forKey: Self.finishActionsKey)?[sessionID] as? String else { return nil }
        // Preserve No action for recordings queued by the earlier Copy experiment.
        return value == "copy" ? .stop : RecordingFinishAction(rawValue: value)
    }

    func setFinishAction(_ action: RecordingFinishAction, expectedID: String) {
        guard activeRecordingID == expectedID else { return }
        var actions = defaults.dictionary(forKey: Self.finishActionsKey) ?? [:]
        actions[expectedID] = action.rawValue
        defaults.set(actions, forKey: Self.finishActionsKey)
    }

    private func clearFinishAction(for sessionID: String) {
        var actions = defaults.dictionary(forKey: Self.finishActionsKey) ?? [:]
        actions.removeValue(forKey: sessionID)
        defaults.set(actions, forKey: Self.finishActionsKey)
    }

    var activeRecordingID: String? { phase == .recording ? String(sessionId) : nil }

    /// Cancel only the capture represented by the confirmation; never delete older queued audio.
    func discardActiveRecording(expectedID: String) {
        guard activeRecordingID == expectedID else { return }
        meterTimer?.invalidate()
        meterTimer = nil
        recorder?.stop()
        recorder = nil
        clearFinishAction(for: expectedID)
        let files = segmentURLs
        segmentURLs = []
        phase = .idle
        startedAt = nil
        elapsed = 0
        level = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        do { for file in files { try FileManager.default.removeItem(at: file) } }
        catch { lastError = "Could not remove discarded audio: \(error.localizedDescription)" }
        onCaptureCancelled?()
    }

    func toggle() {
        switch phase {
        case .idle: start()
        case .recording: Task { await stopAndTranscribe() }
        case .transcribing: break
        }
    }

    func start() {
        guard workEnabled, phase == .idle else { return }
        let generation = workGeneration
        lastError = nil
        AVAudioApplication.requestRecordPermission { [weak self] granted in
            Task { @MainActor in
                guard let self, self.workEnabled, self.workGeneration == generation, self.phase == .idle else { return }
                guard granted else {
                    self.lastError = "Microphone access is off. Enable it in Settings."
                    return
                }
                self.beginSession()
            }
        }
    }

    /// An intent must finish starting the microphone before returning to the system.
    func startFromIntent() throws {
        guard workEnabled, phase == .idle else {
            throw SpeechTranscriptionEngineError(message: "Open Field Theory and finish the current recording first.")
        }
        guard AVAudioApplication.shared.recordPermission == .granted else {
            throw SpeechTranscriptionEngineError(message: "Open Field Theory and allow microphone access first.")
        }
        lastError = nil
        beginSession(mixWithOtherAudio: true)
        guard phase == .recording else {
            throw lastStartFailure ?? SpeechTranscriptionEngineError(message: lastError ?? "Recording could not start.")
        }
    }

    private func beginSession(mixWithOtherAudio: Bool = false) {
        lastStartFailure = nil
        do {
            let session = AVAudioSession.sharedInstance()
            // A background intent must not request interruption of the foreground app's audio.
            var options: AVAudioSession.CategoryOptions = [.allowBluetoothHFP]
            if mixWithOtherAudio { options.insert(.mixWithOthers) }
            BackgroundRecordingSession.shared.recordEvidence("audio-category-setting")
            try session.setCategory(.playAndRecord, mode: .default, options: options)
            BackgroundRecordingSession.shared.recordEvidence("audio-session-activating")
            try session.setActive(true)
            BackgroundRecordingSession.shared.recordEvidence("audio-session-activated")
            segmentURLs = []
            sessionId = Timestamps.nowMs()
            try startNewSegment()
            phase = .recording
            startedAt = Date()
            elapsed = 0
            startMetering()
            onCaptureStarted?()
        } catch {
            lastStartFailure = error
            BackgroundRecordingSession.shared.recordEvidence("audio-start-failed-before-cleanup", error: error)
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            lastError = "Could not start recording: \(error.localizedDescription)"
            onNotice?("Couldn't start recording", "exclamationmark.triangle")
            phase = .idle
        }
    }

    private func startNewSegment() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("rec-\(sessionId)-\(segmentURLs.count).wav")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ]
        BackgroundRecordingSession.shared.recordEvidence("audio-recorder-creating")
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.isMeteringEnabled = true
        BackgroundRecordingSession.shared.recordEvidence("audio-recorder-starting")
        guard recorder.record() else {
            BackgroundRecordingSession.shared.recordEvidence("audio-recorder-returned-false")
            throw SpeechTranscriptionEngineError(message: "The microphone did not start recording.")
        }
        BackgroundRecordingSession.shared.recordEvidence("audio-recorder-started")
        self.recorder = recorder
        segmentURLs.append(url)
    }

    private func startMetering() {
        meterTimer?.invalidate()
        meterTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let recorder = self.recorder, self.phase == .recording else { return }
                recorder.updateMeters()
                let decibels = recorder.averagePower(forChannel: 0)
                self.level = max(0, min(1, (decibels + 50) / 50))
                if let startedAt = self.startedAt {
                    self.elapsed = Date().timeIntervalSince(startedAt)
                }
            }
        }
    }

    private func handleInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

        BackgroundRecordingSession.shared.recordEvidence("audio-interruption-\(type.rawValue)")
        switch type {
        case .began:
            // A call (or Siri) took the mic. Seal this segment; we resume after.
            recorder?.stop()
            recorder = nil
        case .ended:
            guard phase == .recording else { return }
            let options = (info[AVAudioSessionInterruptionOptionKey] as? UInt)
                .map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
            if options.contains(.shouldResume) || UIApplication.shared.applicationState != .background {
                try? AVAudioSession.sharedInstance().setActive(true)
                try? startNewSegment()
            }
        @unknown default:
            break
        }
    }

    func stopAndTranscribe() async {
        guard workEnabled, phase == .recording else { return }
        onCaptureStopped?()
        defer { onCaptureFinished?() }
        let stoppedAtMs = Timestamps.nowMs()
        meterTimer?.invalidate()
        recorder?.stop()
        recorder = nil
        level = 0

        let urls = segmentURLs
        segmentURLs = []
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        logger.info("Voice recording stopped with \(urls.count, privacy: .public) segment(s)")

        let queued = queueForRetry(urls)
        guard !queued.isEmpty else {
            phase = .idle
            startedAt = nil
            return
        }

        if let first = queued.first {
            stoppedAtMsBySessionID[Self.pendingSessionID(for: first)] = stoppedAtMs
        }

        if !engineReady {
            switch speechEngine.state {
            case .notDownloaded, .downloading:
                phase = .idle
                startedAt = nil
                onNotice?("Saved — download the voice model to transcribe", "clock.arrow.circlepath")
                return
            default: break
            }
        }

        phase = .idle
        startedAt = nil
        await transcribeUserInitiated()
    }

    /// Only Stop and explicit Retry may create a system continued-processing task.
    func transcribeUserInitiated() async {
        guard workEnabled, !draining, !userTranscriptionPending, phase != .recording,
              pendingSessionCount > 0 else { return }
        let generation = workGeneration
        userTranscriptionPending = true
        defer { userTranscriptionPending = false }
        await continuedProcessing.run { [self] progress, hasContinuedRuntime in
            guard workEnabled, workGeneration == generation else { return false }
            transcriptionProgress = progress
            defer { transcriptionProgress = nil }
            if !engineReady {
                do {
                    let engine = speechEngine
                    try await withTaskCancellationHandler {
                        try Task.checkCancellation()
                        try await engine.prepare()
                        try Task.checkCancellation()
                    } onCancel: {
                        Task { @MainActor in engine.cancelPreparation() }
                    }
                } catch {
                    if !(error is CancellationError) {
                        lastError = "Voice model preparation failed: \(error.localizedDescription)"
                    }
                    return false
                }
            }
            guard workEnabled, workGeneration == generation, !Task.isCancelled else { return false }
            await drainPendingQueue(continued: true, hasContinuedRuntime: hasContinuedRuntime)
            return pendingSessionCount == 0 && !Task.isCancelled
        }
    }

    private var engineReady: Bool {
        if transcribeOverride != nil { return true }
        guard case .ready = speechEngine.state else { return false }
        return true
    }

    private func transcribeSegments(
        _ urls: [URL],
        generation: UUID
    ) async throws -> (text: String, inferenceMs: Int64) {
        var parts: [String] = []
        let inferenceStartedAtMs = Timestamps.nowMs()
        for url in urls {
            let completedBeforeFile = progressCompletedFiles
            let totalFiles = progressTotalFiles
            try Task.checkCancellation()
            guard workEnabled, workGeneration == generation else { throw CancellationError() }
            logger.info("Voice transcription starting for \(url.lastPathComponent, privacy: .public)")
            let text: String
            if let transcribeOverride {
                text = try await transcribeOverride(url)
            } else {
                text = try await speechEngine.transcribe(audioURL: url, progress: { [weak self] fraction in
                    guard fraction.isFinite else { return }
                    let completed = (Double(completedBeforeFile) + min(1, max(0, fraction))) / Double(totalFiles)
                    if let progress = self?.transcriptionProgress {
                        progress.completedUnitCount = max(progress.completedUnitCount, Int64(completed * 990))
                    }
                })
            }
            guard workEnabled, workGeneration == generation else { throw CancellationError() }
            try Task.checkCancellation()
            logger.info("Voice transcription finished for \(url.lastPathComponent, privacy: .public)")
            progressCompletedFiles += 1
            if !text.isEmpty { parts.append(text) }
        }
        let text = parts.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        return (
            replaceWords?(text) ?? text,
            max(0, Timestamps.nowMs() - inferenceStartedAtMs)
        )
    }

    /// Transcribes recordings that were parked while the model downloaded.
    /// Segments are grouped by recording session (rec-<session>-<index>.wav)
    /// so one long capture stays one transcript.
    func drainPendingQueue(continued: Bool = false, hasContinuedRuntime: Bool = false) async {
        refreshPendingAudioStatus()
        guard workEnabled, !draining, (!userTranscriptionPending || continued), phase != .recording, pendingSessionCount > 0 else { return }
        requestPreparationIfNeeded()
        let generation = workGeneration
        guard onTranscript != nil else {
            logger.info("Voice pending queue is waiting for transcript routing")
            return
        }
        guard Self.pendingSessions(in: pendingDirectory).first != nil else { return }
        // Runtime preparation is deliberately separate from transcription so
        // the microphone remains available and the UI does not claim inference
        // has started while Core ML is still loading.
        guard engineReady else {
            requestPreparationIfNeeded()
            return
        }
        draining = true
        progressCompletedFiles = 0
        progressTotalFiles = max(1, Self.pendingSessions(in: pendingDirectory).reduce(0) { $0 + $1.files.count })
        let task: UIBackgroundTaskIdentifier = hasContinuedRuntime ? .invalid : beginBackgroundTask()
        phase = .transcribing
        logger.info("Voice pending queue drain started")
        defer {
            finishBackgroundTask(task)
            if workGeneration == generation {
                phase = .idle
                startedAt = nil
                draining = false
                refreshPendingAudioStatus()
            }
        }

        for session in Self.pendingSessions(in: pendingDirectory) {
            guard !Task.isCancelled else { return }
            guard engineReady else {
                requestPreparationIfNeeded()
                break
            }
            let engineIdentity = speechEngine.runtimeIdentity
            let engineWasCold = usedEngineIdentities.insert(engineIdentity).inserted
            do {
                let audio = Self.audioMetrics(for: session.files)
                let queueStartedAtMs = Timestamps.nowMs()
                let result = try await transcribeSegments(session.files, generation: generation)
                guard workEnabled, workGeneration == generation else { return }
                if result.text.isEmpty {
                    onNotice?("No speech detected", "waveform.badge.magnifyingglass")
                } else {
                    let deliveryStartedAtMs = Timestamps.nowMs()
                    currentDeliverySessionID = session.id
                    let task = Task<Bool, Never> {
                        guard workEnabled, workGeneration == generation else { return false }
                        return await onTranscript?(result.text) ?? false
                    }
                    deliveryTask = task
                    deliveryFiles = session.files
                    deliveryBindingURL = Self.engineBindingURL(
                        forSessionID: session.id,
                        in: pendingDirectory
                    )
                    let delivered = await task.value
                    if delivered {
                        lastTranscribedSessionID = session.id
                        clearFinishAction(for: session.id)
                    }
                    currentDeliverySessionID = nil
                    guard workEnabled, workGeneration == generation else { return }
                    deliveryTask = nil
                    deliveryFiles = []
                    deliveryBindingURL = nil
                    guard delivered else {
                        lastError = "The transcript could not be saved. Its audio is queued for retry."
                        onNotice?("Saved audio — retrying transcript later", "clock.arrow.circlepath")
                        break
                    }
                    let deliveryCompletedAtMs = Timestamps.nowMs()
                    let stoppedAtMs = stoppedAtMsBySessionID.removeValue(forKey: session.id)
                    let earlyVisibleAtMs = earlyVisibilityBySessionID.removeValue(forKey: session.id)
                    let metrics = VoiceTranscriptionMetrics(
                        sessionID: session.id,
                        engineIdentity: engineIdentity,
                        segmentCount: session.files.count,
                        audioBytes: audio.bytes,
                        audioDurationMs: audio.durationMs,
                        engineWasCold: engineWasCold,
                        isFirstTranscriptionForEngine: engineWasCold,
                        runtimePreparedBeforeInference: true,
                        queueWaitMs: stoppedAtMs.map { max(0, queueStartedAtMs - $0) },
                        inferenceMs: result.inferenceMs,
                        deliveryMs: max(0, deliveryCompletedAtMs - deliveryStartedAtMs),
                        stopToDeliveryMs: stoppedAtMs.map { max(0, deliveryCompletedAtMs - $0) },
                        stopToVisibleMs: stoppedAtMs.flatMap { stoppedAt in
                            earlyVisibleAtMs.map { max(0, $0 - stoppedAt) }
                        }
                    )
                    if let stoppedAtMs, earlyVisibleAtMs == nil {
                        if pendingVisibility.count >= 16,
                           let oldest = pendingVisibility.min(by: { $0.value.stoppedAtMs < $1.value.stoppedAtMs })?.key {
                            pendingVisibility.removeValue(forKey: oldest)
                        }
                        pendingVisibility[session.id] = (stoppedAtMs, metrics)
                    }
                    publishMetrics(metrics)
                    logger.info("Voice pipeline delivered engine=\(engineIdentity, privacy: .public) cold=\(engineWasCold, privacy: .public) segments=\(metrics.segmentCount, privacy: .public) audio_bytes=\(metrics.audioBytes, privacy: .public) audio_ms=\(metrics.audioDurationMs, privacy: .public) queue_ms=\(metrics.queueWaitMs ?? -1, privacy: .public) inference_ms=\(metrics.inferenceMs, privacy: .public) delivery_ms=\(metrics.deliveryMs, privacy: .public) stop_to_delivery_ms=\(metrics.stopToDeliveryMs ?? -1, privacy: .public)")
                }
                clearFinishAction(for: session.id)
                for url in session.files { try? FileManager.default.removeItem(at: url) }
                try? FileManager.default.removeItem(
                    at: Self.engineBindingURL(forSessionID: session.id, in: pendingDirectory)
                )
                lastError = nil
                refreshPendingAudioStatus()
            } catch {
                guard workEnabled, workGeneration == generation else { return }
                if error is CancellationError {
                    onNotice?("Saved — transcription paused", "clock.arrow.circlepath")
                    break
                }
                lastError = "Parakeet transcription failed: \(error.localizedDescription)"
                logger.error("Voice transcription failed engine=\(engineIdentity, privacy: .public) error=\(error.localizedDescription, privacy: .public)")
                onNotice?("Saved — retry transcription when Field Theory is open", "clock.arrow.circlepath")
                break
            }
        }
    }

    func resumePendingWork() async {
        refreshPendingAudioStatus()
        requestPreparationIfNeeded()
        await drainPendingQueue()
    }

    /// Only the exact idle queue item shown in the confirmation may be removed.
    /// A resumed transcription or changed queue makes an old confirmation inert.
    func discardPendingSession(_ session: PendingAudioSession) {
        guard phase == .idle, !draining,
              Self.pendingSessions(in: pendingDirectory).first == session else { return }
        do {
            for file in session.files { try FileManager.default.removeItem(at: file) }
            let binding = Self.engineBindingURL(forSessionID: session.id, in: pendingDirectory)
            if FileManager.default.fileExists(atPath: binding.path) {
                try FileManager.default.removeItem(at: binding)
            }
            clearFinishAction(for: session.id)
            stoppedAtMsBySessionID.removeValue(forKey: session.id)
            lastError = nil
        } catch {
            lastError = "Could not discard audio: \(error.localizedDescription)"
        }
        refreshPendingAudioStatus()
    }

    func refreshPendingAudioStatus() {
        let sessions = Self.pendingSessions(in: pendingDirectory)
        pendingSessionCount = sessions.count
        nextPendingSession = sessions.first
    }

    /// Copies a real WAV into the same durable queue used by microphone audio.
    /// Intended for an isolated physical-device benchmark harness; inference
    /// and delivery are not substituted.
    @discardableResult
    func enqueueAudioFixtureForBenchmark(_ sourceURL: URL) throws -> String {
        guard sourceURL.pathExtension.lowercased() == "wav",
              FileManager.default.fileExists(atPath: sourceURL.path) else {
            throw SpeechTranscriptionEngineError(message: "Benchmark fixture must be an existing WAV file")
        }
        var sessionID = Timestamps.nowMs()
        var temporaryURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("rec-\(sessionID)-0.wav")
        while FileManager.default.fileExists(atPath: temporaryURL.path)
            || FileManager.default.fileExists(atPath: pendingDirectory.appendingPathComponent(temporaryURL.lastPathComponent).path) {
            sessionID += 1
            temporaryURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("rec-\(sessionID)-0.wav")
        }
        try FileManager.default.copyItem(at: sourceURL, to: temporaryURL)
        let queued = queueForRetry([temporaryURL])
        guard let parked = queued.first else {
            throw SpeechTranscriptionEngineError(message: lastError ?? "Could not queue benchmark fixture")
        }
        let id = Self.pendingSessionID(for: parked)
        stoppedAtMsBySessionID[id] = Timestamps.nowMs()
        return id
    }

    private nonisolated static func audioMetrics(for urls: [URL]) -> (bytes: Int64, durationMs: Int64) {
        var bytes: Int64 = 0
        var durationMs: Int64 = 0
        for url in urls {
            if let values = try? url.resourceValues(forKeys: [.fileSizeKey]), let size = values.fileSize {
                bytes += Int64(size)
            }
            if let file = try? AVAudioFile(forReading: url), file.fileFormat.sampleRate > 0 {
                durationMs += Int64((Double(file.length) / file.fileFormat.sampleRate * 1_000).rounded())
            }
        }
        return (bytes, durationMs)
    }

    private func queueForRetry(_ urls: [URL]) -> [URL] {
        guard !urls.isEmpty else { return [] }
        do {
            try FileManager.default.createDirectory(at: pendingDirectory, withIntermediateDirectories: true)
        } catch {
            lastError = "Could not save recording: \(error.localizedDescription)"
            logger.error("Voice pending directory could not be created: \(error.localizedDescription, privacy: .public)")
            onNotice?("Could not save recording", "exclamationmark.triangle")
            return []
        }
        do {
            try excludePendingDirectoryFromBackup()
        } catch {
            // Preserve the only copy and surface the privacy-setting failure;
            // a later retry re-applies the exclusion before adding new audio.
            lastError = "Saved recordings could not be protected from device backup: \(error.localizedDescription)"
            logger.error("Voice pending directory backup exclusion failed: \(error.localizedDescription, privacy: .public)")
            onNotice?("Saved recording needs storage attention", "exclamationmark.triangle")
        }

        var queued: [URL] = []
        for url in urls where FileManager.default.fileExists(atPath: url.path) {
            let parked = Self.parakeetBoundPendingURL(for: url, in: pendingDirectory)
            do {
                if parked != url, FileManager.default.fileExists(atPath: parked.path) {
                    try FileManager.default.removeItem(at: parked)
                }
                if parked != url {
                    try FileManager.default.moveItem(at: url, to: parked)
                }
                queued.append(parked)
                logger.info("Voice audio queued at \(parked.lastPathComponent, privacy: .public)")
            } catch {
                lastError = "Could not save recording: \(error.localizedDescription)"
                logger.error("Voice audio could not be queued: \(error.localizedDescription, privacy: .public)")
                onNotice?("Could not save recording", "exclamationmark.triangle")
            }
        }
        for sessionID in Set(queued.map(Self.pendingSessionID(for:))) {
            do {
                let binding = PendingAudioEngineBinding(schemaVersion: 2, engine: "parakeet")
                let data = try JSONEncoder().encode(binding)
                try data.write(
                    to: Self.engineBindingURL(forSessionID: sessionID, in: pendingDirectory),
                    options: .atomic
                )
            } catch {
                // The engine marker is also embedded in every newly queued WAV
                // filename, so failure to write the redundant sidecar cannot
                // silently reroute this recording after relaunch.
                logger.error("Voice engine sidecar could not be written: \(error.localizedDescription, privacy: .public)")
            }
        }
        refreshPendingAudioStatus()
        return queued
    }

    private func excludePendingDirectoryFromBackup() throws {
        var directory = pendingDirectory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
    }

    private func beginBackgroundTask() -> UIBackgroundTaskIdentifier {
        var task: UIBackgroundTaskIdentifier = .invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "FieldTheoryVoiceTranscription") { [weak self] in
            Task { @MainActor in
                self?.logger.warning("Voice background transcription task expired")
                self?.onNotice?("Saved — retrying when Field Theory reopens", "clock.arrow.circlepath")
                self?.finishBackgroundTask(task)
            }
        }
        if task != .invalid { backgroundTasks.insert(task) }
        return task
    }

    private func finishBackgroundTask(_ task: UIBackgroundTaskIdentifier) {
        guard task != .invalid, backgroundTasks.remove(task) != nil else { return }
        UIApplication.shared.endBackgroundTask(task)
    }

    nonisolated static func pendingSessions(in directory: URL) -> [PendingAudioSession] {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        let wavs = files.filter { $0.pathExtension == "wav" }
        var sessions: [String: [URL]] = [:]
        for url in wavs {
            sessions[pendingSessionID(for: url), default: []].append(url)
        }
        return sessions
            .map { id, files in
                PendingAudioSession(
                    id: id,
                    files: files.sorted(by: pendingAudioSort)
                )
            }
            .sorted { lhs, rhs in
                if let left = Int64(lhs.id), let right = Int64(rhs.id) {
                    return left < right
                }
                return lhs.id < rhs.id
            }
    }

    private nonisolated static func pendingSessionID(for url: URL) -> String {
        let stem = url.deletingPathExtension().lastPathComponent
        let parts = stem.split(separator: "-")
        if parts.count >= 3, parts.first == "rec" {
            return String(parts[1])
        }
        return stem
    }

    private nonisolated static func engineBindingURL(forSessionID id: String, in directory: URL) -> URL {
        directory.appendingPathComponent("rec-\(id).engine.json")
    }

    private nonisolated static func parakeetBoundPendingURL(for source: URL, in directory: URL) -> URL {
        let stem = source.deletingPathExtension().lastPathComponent
        return directory.appendingPathComponent("\(stem)-engine-parakeet.wav")
    }

    /// Converts old implicit queues and Whisper sidecars to the only supported
    /// engine without moving or deleting their WAV files.
    private func migratePendingAudioToParakeet() throws {
        for session in Self.pendingSessions(in: pendingDirectory) {
            let url = Self.engineBindingURL(forSessionID: session.id, in: pendingDirectory)
            if let data = try? Data(contentsOf: url),
               let binding = try? JSONDecoder().decode(PendingAudioEngineBinding.self, from: data),
               binding.schemaVersion == 2,
               binding.engine == "parakeet" {
                continue
            }
            let binding = PendingAudioEngineBinding(schemaVersion: 2, engine: "parakeet")
            try JSONEncoder().encode(binding).write(to: url, options: .atomic)
        }
    }

    private nonisolated static func pendingAudioSort(_ lhs: URL, _ rhs: URL) -> Bool {
        let left = pendingSegmentIndex(for: lhs)
        let right = pendingSegmentIndex(for: rhs)
        if left != right { return left < right }
        return lhs.lastPathComponent < rhs.lastPathComponent
    }

    private nonisolated static func pendingSegmentIndex(for url: URL) -> Int {
        let stem = url.deletingPathExtension().lastPathComponent
        let parts = stem.split(separator: "-")
        guard parts.count >= 3, parts.first == "rec" else { return 0 }
        return Int(parts[2]) ?? 0
    }
}
