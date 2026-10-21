import AVFoundation
import Foundation
import os

/// No AVAudioRecorder or mutable AV state leaves this executor.
actor AudioCaptureOwner {
    struct Started: Sendable {
        let sessionID: Int64
        let startedAt: Date
        let files: [URL]
    }

    struct Sample: Sendable {
        let level: Float
        let isRecording: Bool
        let recordedSeconds: TimeInterval
    }

    private let makeDevice: @Sendable () -> any AudioCaptureDevice
    private var device: (any AudioCaptureDevice)?
    private var token: UUID?
    // A stop can arrive before its suspended caller enters start().
    private var cancelledTokens = Set<UUID>()
    private var sessionID: Int64 = 0
    private var files: [URL] = []
    private let logger = Logger(subsystem: "com.afar1.fieldtheory", category: "AudioCapture")
    private var interrupted = false
    private var preparationRevision = 0
    private var preparationEnabled = false
    private var preparedURL: URL?
    private var preparedSessionID: Int64?
    private var lastPreparedSessionID: Int64 = 0
    private var deliveryPolicyBoundary: Int64?

    /// Revisions reject an older lifecycle task arriving after a newer one.
    /// Allocating the recorder is safe before a tap; prepareToRecord is deferred
    /// until the user has explicitly activated the audio session.
    func setPreparationEnabled(_ enabled: Bool, revision: Int, afterPolicyChangeAt boundary: Int64? = nil) {
        guard revision >= preparationRevision else { return }
        preparationRevision = revision
        preparationEnabled = enabled
        guard token == nil else { return } // Never disturb active/background capture.
        if let boundary {
            discardPreparedRecorder()
            lastPreparedSessionID = max(lastPreparedSessionID, boundary)
            deliveryPolicyBoundary = max(deliveryPolicyBoundary ?? boundary, boundary)
        }
        if enabled { prepareNextRecorder() } else { releaseIdleResources() }
    }

    func invalidatePreparation() {
        guard token == nil else { return }
        releaseIdleResources()
    }

    private func releaseIdleResources() {
        discardPreparedRecorder()
        device?.deactivate()
        device = nil
    }

    private func discardPreparedRecorder() {
        guard let url = preparedURL else { return }
        device?.stop()
        try? FileManager.default.removeItem(at: url)
        preparedURL = nil
        preparedSessionID = nil
    }

    private func prepareNextRecorder() {
        guard preparationEnabled, token == nil, preparedURL == nil else { return }
        let device = self.device ?? makeDevice()
        self.device = device
        let nextSessionID = max(Timestamps.nowMs(), max(lastPreparedSessionID, sessionID) + 1)
        lastPreparedSessionID = nextSessionID
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("rec-\(nextSessionID)-0.wav")
        do {
            try device.prepare(url: url, readyToRecord: false)
            preparedURL = url
            preparedSessionID = nextSessionID
        } catch {
            device.stop()
            try? FileManager.default.removeItem(at: url)
            device.deactivate()
            logger.error("Recorder preparation failed; using cold start: \(error.localizedDescription, privacy: .public)")
        }
    }

    init(makeDevice: @escaping @Sendable () -> any AudioCaptureDevice = { LiveAudioCaptureDevice() }) {
        self.makeDevice = makeDevice
    }

    func start(token requestedToken: UUID, sessionID: Int64, mixWithOtherAudio: Bool = false,
               trace: RecordingStartupTrace? = nil, applicationState: Int? = nil) async throws -> Started {
        trace?.mark("audio.owner-entered")
        guard !cancelledTokens.contains(requestedToken), token == nil else { throw CancellationError() }
        token = requestedToken
        // A failed preparation must not replace the caller's cold-start identity.
        // Only an explicit policy change can require advancing that identity.
        let coldSessionID = deliveryPolicyBoundary.map { max(sessionID, $0 + 1) } ?? sessionID
        self.sessionID = preparedSessionID ?? coldSessionID
        files = []
        interrupted = false
        let device = self.device ?? makeDevice()
        self.device = device
        device.beginStartupDiagnostic(sessionID: self.sessionID, applicationState: applicationState,
                                      mixWithOtherAudio: mixWithOtherAudio)
        do {
            var sessionConfigured = false
            let delays: [Duration] = [.milliseconds(250), .milliseconds(500), .seconds(1)]
            for attempt in 0...delays.count {
                try Task.checkCancellation()
                guard token == requestedToken, !cancelledTokens.contains(requestedToken), !interrupted else {
                    throw CancellationError()
                }
                device.setStartupAttempt(attempt + 1)
                do {
                    if !sessionConfigured {
                        trace?.mark("audio.configure-begin")
                        try device.configure(mixWithOtherAudio: mixWithOtherAudio, trace: trace)
                        trace?.mark("audio.configure-end")
                        sessionConfigured = true
                    }
                    try startSegment(using: device, trace: trace)
                    trace?.mark("audio.capture-started")
                    device.finishStartupDiagnostic(error: nil)
                    return Started(sessionID: self.sessionID, startedAt: Date(), files: files)
                } catch {
                    let retryable: Bool
                    if case MicrophoneStartError.notStarted = error {
                        retryable = true
                    } else {
                        let failure = error as NSError
                        // Bluetooth profile changes can temporarily prevent activation.
                        // Never retry permission/category errors or try foregrounding.
                        let transientCodes = [AVAudioSession.ErrorCode.insufficientPriority.rawValue,
                                              AVAudioSession.ErrorCode.resourceNotAvailable.rawValue,
                                              AVAudioSession.ErrorCode.cannotStartRecording.rawValue,
                                              AVAudioSession.ErrorCode.cannotStartPlaying.rawValue]
                        retryable = !sessionConfigured && failure.domain == NSOSStatusErrorDomain
                            && transientCodes.contains(failure.code)
                    }
                    guard retryable, attempt < delays.count else { throw error }
                    if !sessionConfigured { device.deactivate() }
                    trace?.mark("audio.retry-wait")
                    try await Task.sleep(for: delays[attempt])
                }
            }
            throw MicrophoneStartError.notStarted
        } catch {
            device.finishStartupDiagnostic(error: error)
            trace?.mark(error is CancellationError ? "audio.start-cancelled" : "audio.start-failed")
            if token == requestedToken {
                device.stop()
                device.deactivate()
                discardPreparedRecorder()
                token = nil
                files = []
            }
            throw error
        }
    }

    /// Invalidation also covers a start which has not reached this actor yet.
    func stop(token expectedToken: UUID) -> [URL] {
        cancelledTokens.insert(expectedToken)
        guard token == expectedToken else { return [] }
        device?.stop()
        token = nil
        interrupted = false
        let result = files
        files = []
        // Stop must relinquish the session even when foreground preparation is
        // enabled, so interrupted music can resume before transcription finishes.
        releaseIdleResources()
        // The controller requests the next preparation after publishing idle,
        // so sealing/closing never waits for the next microphone preparation.
        return result
    }

    func sample(token expectedToken: UUID) -> Sample? {
        guard token == expectedToken, !interrupted else { return nil }
        return device?.sample()
    }

    func interruptionBegan(token expectedToken: UUID) {
        guard token == expectedToken else { return }
        interrupted = true
        device?.stop()
    }

    func interruptionEnded(token expectedToken: UUID, shouldResume: Bool) throws -> [URL] {
        guard token == expectedToken, interrupted, shouldResume, let device else { return files }
        do {
            try device.activate()
            try startSegment(using: device)
            interrupted = false
        } catch {
            device.stop()
            device.deactivate()
            throw error
        }
        return files
    }

    private func startSegment(using device: any AudioCaptureDevice, trace: RecordingStartupTrace? = nil) throws {
        let url = preparedURL ?? FileManager.default.temporaryDirectory
            .appendingPathComponent("rec-\(sessionID)-\(files.count).wav")
        if preparedURL != nil { trace?.mark("audio.staged-recorder-consumed") }
        preparedURL = nil
        preparedSessionID = nil
        do {
            try device.start(url: url, trace: trace)
            files.append(url)
        } catch {
            device.stop()
            try? FileManager.default.removeItem(at: url)
            throw error
        }
    }
}

/// Injectable at the actor boundary so cancellation/retry ownership can be tested without a microphone.
protocol AudioCaptureDevice: AnyObject {
    func beginStartupDiagnostic(sessionID: Int64, applicationState: Int?, mixWithOtherAudio: Bool)
    func setStartupAttempt(_ attempt: Int)
    func finishStartupDiagnostic(error: Error?)
    func prepare(url: URL, readyToRecord: Bool) throws
    func configure(mixWithOtherAudio: Bool) throws
    func configure(mixWithOtherAudio: Bool, trace: RecordingStartupTrace?) throws
    func activate() throws
    func start(url: URL) throws
    func start(url: URL, trace: RecordingStartupTrace?) throws
    func stop()
    func deactivate()
    func sample() -> AudioCaptureOwner.Sample?
}

extension AudioCaptureDevice {
    func beginStartupDiagnostic(sessionID: Int64, applicationState: Int?, mixWithOtherAudio: Bool) {}
    func setStartupAttempt(_ attempt: Int) {}
    func finishStartupDiagnostic(error: Error?) {}
    func configure(mixWithOtherAudio: Bool, trace: RecordingStartupTrace?) throws {
        try configure(mixWithOtherAudio: mixWithOtherAudio)
    }
    func start(url: URL, trace: RecordingStartupTrace?) throws { try start(url: url) }
}

private final class LiveAudioCaptureDevice: AudioCaptureDevice {
    private var recorder: AVAudioRecorder?
    private var bluetoothInputUID: String?
    private var recorderPrepared = false
    // Temporary, bounded device evidence. No audio, names, UIDs, paths, or transcripts.
    private var startupDiagnostic: [String: Any]?
    private var startupEvents: [[String: Any]] = []
    private var startupAttempt = 0
    private var startupStage = "starting"

    func configure(mixWithOtherAudio: Bool) throws { try configure(mixWithOtherAudio: mixWithOtherAudio, trace: nil) }

    func configure(mixWithOtherAudio: Bool, trace: RecordingStartupTrace?) throws {
        let session = AVAudioSession.sharedInstance()
        // Background intents must mix so iOS can activate them without opening the app.
        var options: AVAudioSession.CategoryOptions = [.allowBluetoothHFP]
        // Mixing alone leaves media at the Bluetooth route's normal volume.
        // Request quieter media for capture; deactivation on Stop restores it.
        if mixWithOtherAudio { options.formUnion([.mixWithOthers, .duckOthers]) }
        trace?.mark("audio.category-begin")
        try diagnosticStep("category") {
            try session.setCategory(.playAndRecord, mode: .default, options: options)
        }
        trace?.mark("audio.category-end")
        trace?.mark("audio.activation-begin")
        try diagnosticStep("activation") { try session.setActive(true) }
        trace?.mark("audio.activation-end")
        let input = session.currentRoute.inputs.first
        bluetoothInputUID = input?.portType == .bluetoothHFP ? input?.uid : nil
        if let input, bluetoothInputUID != nil {
            try diagnosticStep("preferred-input") { try session.setPreferredInput(input) }
        }
    }

    func beginStartupDiagnostic(sessionID: Int64, applicationState: Int?, mixWithOtherAudio: Bool) {
        startupAttempt = 0
        startupEvents = []
        startupDiagnostic = ["sessionID": String(sessionID), "timestamp": Date().timeIntervalSince1970,
                             "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
                             "applicationStateAtRequest": applicationState.map { $0 as Any } ?? NSNull(),
                             "mixWithOtherAudio": mixWithOtherAudio,
                             "stagedRecorder": recorder != nil, "stagedRecorderPrepared": recorderPrepared]
        recordStartupEvent("starting")
    }

    func setStartupAttempt(_ attempt: Int) {
        startupAttempt = attempt
        recordStartupEvent("attempt")
    }

    private func recordStartupEvent(_ stage: String, result: Bool? = nil, error: Error? = nil) {
        guard startupDiagnostic != nil, startupEvents.count < 96 else { return }
        startupStage = stage
        let session = AVAudioSession.sharedInstance()
        var event: [String: Any] = [
            "stage": stage, "attempt": startupAttempt, "timestamp": Date().timeIntervalSince1970,
            "category": session.category.rawValue, "mode": session.mode.rawValue,
            "categoryOptions": session.categoryOptions.rawValue,
            "inputPortTypes": session.currentRoute.inputs.map { $0.portType.rawValue },
            "outputPortTypes": session.currentRoute.outputs.map { $0.portType.rawValue },
            "availableInputPortTypes": (session.availableInputs ?? []).map { $0.portType.rawValue },
            "inputAvailable": session.isInputAvailable, "otherAudioPlaying": session.isOtherAudioPlaying,
            "secondaryAudioShouldBeSilenced": session.secondaryAudioShouldBeSilencedHint,
            "sampleRate": session.sampleRate, "inputChannels": session.inputNumberOfChannels,
            "outputVolume": session.outputVolume,
        ]
        if let result { event["result"] = result }
        if let error {
            let failure = error as NSError
            event["errorDomain"] = failure.domain
            event["errorCode"] = failure.code
        }
        startupEvents.append(event)
    }

    private func diagnosticStep<T>(_ stage: String, operation: () throws -> T) rethrows -> T {
        recordStartupEvent(stage)
        do {
            let value = try operation()
            recordStartupEvent(stage, result: (value as? Bool) ?? true)
            return value
        } catch {
            recordStartupEvent(stage, result: false, error: error)
            throw error
        }
    }

    func finishStartupDiagnostic(error: Error?) {
        guard var snapshot = startupDiagnostic else { return }
        snapshot["outcome"] = error == nil ? "recording" : "failed"
        snapshot["finalStage"] = startupStage
        snapshot["attempts"] = startupAttempt
        if let error {
            let failure = error as NSError
            snapshot["errorDomain"] = failure.domain
            snapshot["errorCode"] = failure.code
        }
        snapshot["events"] = startupEvents
        startupDiagnostic = nil
        startupEvents = []
        do {
            let directory = RecorderController.voiceDiagnosticsDir
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: snapshot, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: directory.appendingPathComponent("audio-startup-latest.json"), options: .atomic)
            if error != nil {
                try data.write(to: directory.appendingPathComponent("audio-startup-failure.json"), options: .atomic)
            }
        } catch { /* Diagnostics must not replace or interrupt capture. */ }
    }

    func activate() throws { try AVAudioSession.sharedInstance().setActive(true) }

    func start(url: URL) throws { try start(url: url, trace: nil) }

    func start(url: URL, trace: RecordingStartupTrace?) throws {
        recordStartupEvent("input-route-check")
        if let bluetoothInputUID,
           AVAudioSession.sharedInstance().currentRoute.inputs.first?.uid != bluetoothInputUID {
            throw SpeechTranscriptionEngineError(message: "The Bluetooth microphone disconnected. Try recording again.")
        }
        if recorder?.url != url { try prepare(url: url, readyToRecord: true, trace: trace) }
        guard let recorder else { throw MicrophoneStartError.notStarted }
        if !recorderPrepared {
            trace?.mark("audio.prepare-to-record-begin")
            let prepared = diagnosticStep("prepare-to-record") { recorder.prepareToRecord() }
            trace?.mark("audio.prepare-to-record-end")
            guard prepared else { throw MicrophoneStartError.notStarted }
            recorderPrepared = true
        }
        trace?.mark("audio.record-call-begin")
        let recording = diagnosticStep("record") { recorder.record() }
        trace?.mark("audio.record-call-end")
        guard recording else {
            recorder.stop()
            recorder.deleteRecording()
            throw MicrophoneStartError.notStarted
        }
        self.recorder = recorder
    }

    func prepare(url: URL, readyToRecord: Bool) throws { try prepare(url: url, readyToRecord: readyToRecord, trace: nil) }

    private func prepare(url: URL, readyToRecord: Bool, trace: RecordingStartupTrace?) throws {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false
        ]
        trace?.mark("audio.recorder-allocation-begin")
        let recorder = try diagnosticStep("recorder-allocation") { try AVAudioRecorder(url: url, settings: settings) }
        trace?.mark("audio.recorder-allocation-end")
        recorder.isMeteringEnabled = true
        self.recorder = recorder
        recorderPrepared = false
        // AVFoundation can activate sessions automatically. Never call this
        // while idle, after the recording session has been relinquished.
        if readyToRecord {
            trace?.mark("audio.prepare-to-record-begin")
            let prepared = diagnosticStep("prepare-to-record") { recorder.prepareToRecord() }
            trace?.mark("audio.prepare-to-record-end")
            guard prepared else { throw MicrophoneStartError.notStarted }
            recorderPrepared = true
        }
    }

    func stop() { recorder?.stop(); recorder = nil; recorderPrepared = false }
    func deactivate() {
        try? diagnosticStep("deactivation") {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
    func sample() -> AudioCaptureOwner.Sample? {
        guard let recorder else { return nil }
        recorder.updateMeters()
        return .init(level: max(0, min(1, (recorder.averagePower(forChannel: 0) + 50) / 50)),
                     isRecording: recorder.isRecording, recordedSeconds: recorder.currentTime)
    }
}
