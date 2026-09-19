import AVFoundation
import Foundation

/// No AVAudioRecorder or mutable AV state leaves this executor.
actor AudioCaptureOwner {
    typealias Evidence = @Sendable (String, Error?, [String: Any]) -> Void

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
    private var evidence: Evidence = { _, _, _ in }
    private var interrupted = false
    private var preparationRevision = 0
    private var preparationEnabled = false
    private var preparedURL: URL?
    private var preparedSessionID: Int64?
    private var lastPreparedSessionID: Int64 = 0
    private var configuredMix: Bool?

    /// Revisions reject an older lifecycle task arriving after a newer one.
    /// Allocating the recorder is safe before a tap; prepareToRecord is deferred
    /// until the user has explicitly activated the audio session.
    func setPreparationEnabled(_ enabled: Bool, revision: Int) {
        guard revision >= preparationRevision else { return }
        preparationRevision = revision
        preparationEnabled = enabled
        guard token == nil else { return } // Never disturb active/background capture.
        if enabled { prepareNextRecorder() } else { releaseIdleResources() }
    }

    func invalidatePreparation() {
        configuredMix = nil
        guard token == nil else { return }
        releaseIdleResources()
    }

    private func releaseIdleResources() {
        discardPreparedRecorder()
        device?.deactivate()
        configuredMix = nil
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
            try device.prepare(url: url, readyToRecord: configuredMix != nil, evidence: evidence)
            preparedURL = url
            preparedSessionID = nextSessionID
            evidence(configuredMix == nil ? "audio-recorder-staged" : "audio-recorder-prepared", nil, [:])
        } catch {
            device.stop()
            try? FileManager.default.removeItem(at: url)
            device.deactivate()
            configuredMix = nil
            evidence("audio-preparation-failed-cold-fallback", error, [:])
        }
    }

    init(makeDevice: @escaping @Sendable () -> any AudioCaptureDevice = { LiveAudioCaptureDevice() }) {
        self.makeDevice = makeDevice
    }

    func start(token requestedToken: UUID, sessionID: Int64, mixWithOtherAudio: Bool,
               evidence: @escaping Evidence) async throws -> Started {
        guard !cancelledTokens.contains(requestedToken), token == nil else { throw CancellationError() }
        token = requestedToken
        self.sessionID = preparedSessionID ?? sessionID
        self.evidence = evidence
        files = []
        interrupted = false
        let device = self.device ?? makeDevice()
        self.device = device
        do {
            if configuredMix != mixWithOtherAudio {
                try device.configure(mixWithOtherAudio: mixWithOtherAudio, evidence: evidence)
                configuredMix = mixWithOtherAudio
            } else {
                evidence("audio-session-reused", nil, [:])
            }
            let delays: [Duration] = [.milliseconds(250), .milliseconds(500), .seconds(1)]
            for attempt in 0...delays.count {
                try Task.checkCancellation()
                guard token == requestedToken, !cancelledTokens.contains(requestedToken), !interrupted else {
                    throw CancellationError()
                }
                do {
                    try startSegment(using: device)
                    return Started(sessionID: self.sessionID, startedAt: Date(), files: files)
                } catch MicrophoneStartError.notStarted {
                    guard attempt < delays.count else { throw MicrophoneStartError.notStarted }
                    evidence("audio-recorder-retry-wait", nil, [:])
                    try await Task.sleep(for: delays[attempt])
                }
            }
            throw MicrophoneStartError.notStarted
        } catch {
            if token == requestedToken {
                evidence("audio-start-failed-before-cleanup", error, [:])
                device.stop()
                device.deactivate()
                configuredMix = nil
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
        if !preparationEnabled || configuredMix == nil { releaseIdleResources() }
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
        configuredMix = nil
        device?.stop()
    }

    func interruptionEnded(token expectedToken: UUID, shouldResume: Bool, evidence: Evidence? = nil) throws -> [URL] {
        guard token == expectedToken, interrupted, shouldResume, let device else { return files }
        if let evidence { self.evidence = evidence }
        try device.activate()
        try startSegment(using: device)
        interrupted = false
        return files
    }

    private func startSegment(using device: any AudioCaptureDevice) throws {
        let url = preparedURL ?? FileManager.default.temporaryDirectory
            .appendingPathComponent("rec-\(sessionID)-\(files.count).wav")
        if preparedURL != nil { evidence("audio-prepared-recorder-consumed", nil, [:]) }
        preparedURL = nil
        preparedSessionID = nil
        do {
            try device.start(url: url, evidence: evidence)
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
    func prepare(url: URL, readyToRecord: Bool, evidence: AudioCaptureOwner.Evidence) throws
    func configure(mixWithOtherAudio: Bool, evidence: AudioCaptureOwner.Evidence) throws
    func activate() throws
    func start(url: URL, evidence: AudioCaptureOwner.Evidence) throws
    func stop()
    func deactivate()
    func sample() -> AudioCaptureOwner.Sample?
}

private final class LiveAudioCaptureDevice: AudioCaptureDevice {
    private var recorder: AVAudioRecorder?
    private var bluetoothInputUID: String?
    private var recorderPrepared = false

    func configure(mixWithOtherAudio: Bool, evidence: AudioCaptureOwner.Evidence) throws {
        let session = AVAudioSession.sharedInstance()
        var options: AVAudioSession.CategoryOptions = [.allowBluetoothHFP]
        if mixWithOtherAudio { options.insert(.mixWithOthers) }
        evidence("audio-category-setting", nil, [:])
        try session.setCategory(.playAndRecord, mode: .default, options: options)
        evidence("audio-session-activating", nil, [:])
        try session.setActive(true)
        evidence("audio-session-activated", nil, [:])
        let input = session.currentRoute.inputs.first
        bluetoothInputUID = input?.portType == .bluetoothHFP ? input?.uid : nil
        if let input, bluetoothInputUID != nil { try session.setPreferredInput(input) }
    }

    func activate() throws { try AVAudioSession.sharedInstance().setActive(true) }

    func start(url: URL, evidence: AudioCaptureOwner.Evidence) throws {
        if let bluetoothInputUID,
           AVAudioSession.sharedInstance().currentRoute.inputs.first?.uid != bluetoothInputUID {
            throw SpeechTranscriptionEngineError(message: "The Bluetooth microphone disconnected. Try recording again.")
        }
        if recorder?.url != url { try prepare(url: url, readyToRecord: true, evidence: evidence) }
        guard let recorder else { throw MicrophoneStartError.notStarted }
        if !recorderPrepared {
            guard recorder.prepareToRecord() else { throw MicrophoneStartError.notStarted }
            recorderPrepared = true
        }
        evidence("audio-recorder-starting", nil, [:])
        guard recorder.record() else {
            evidence("audio-recorder-returned-false", nil, [:])
            recorder.stop()
            recorder.deleteRecording()
            throw MicrophoneStartError.notStarted
        }
        self.recorder = recorder
        evidence("audio-recorder-started", nil, [:])
    }

    func prepare(url: URL, readyToRecord: Bool, evidence: AudioCaptureOwner.Evidence) throws {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false
        ]
        evidence("audio-recorder-creating", nil, [:])
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.isMeteringEnabled = true
        self.recorder = recorder
        recorderPrepared = false
        // AVFoundation can activate sessions automatically. Never call this
        // before the first explicit recording has activated our session.
        if readyToRecord {
            guard recorder.prepareToRecord() else { throw MicrophoneStartError.notStarted }
            recorderPrepared = true
        }
    }

    func stop() { recorder?.stop(); recorder = nil; recorderPrepared = false }
    func deactivate() { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    func sample() -> AudioCaptureOwner.Sample? {
        guard let recorder else { return nil }
        recorder.updateMeters()
        return .init(level: max(0, min(1, (recorder.averagePower(forChannel: 0) + 50) / 50)),
                     isRecording: recorder.isRecording, recordedSeconds: recorder.currentTime)
    }
}
