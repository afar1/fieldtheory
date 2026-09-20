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
    private var configuredMix: Bool?

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
            try device.prepare(url: url, readyToRecord: configuredMix != nil)
            preparedURL = url
            preparedSessionID = nextSessionID
        } catch {
            device.stop()
            try? FileManager.default.removeItem(at: url)
            device.deactivate()
            configuredMix = nil
            logger.error("Recorder preparation failed; using cold start: \(error.localizedDescription, privacy: .public)")
        }
    }

    init(makeDevice: @escaping @Sendable () -> any AudioCaptureDevice = { LiveAudioCaptureDevice() }) {
        self.makeDevice = makeDevice
    }

    func start(token requestedToken: UUID, sessionID: Int64, mixWithOtherAudio: Bool,
               trace: RecordingStartupTrace? = nil) async throws -> Started {
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
        do {
            if configuredMix != mixWithOtherAudio {
                trace?.mark("audio.configure-begin")
                try device.configure(mixWithOtherAudio: mixWithOtherAudio, trace: trace)
                trace?.mark("audio.configure-end")
                configuredMix = mixWithOtherAudio
            } else { trace?.mark("audio.session-reused") }
            let delays: [Duration] = [.milliseconds(250), .milliseconds(500), .seconds(1)]
            for attempt in 0...delays.count {
                try Task.checkCancellation()
                guard token == requestedToken, !cancelledTokens.contains(requestedToken), !interrupted else {
                    throw CancellationError()
                }
                do {
                    try startSegment(using: device, trace: trace)
                    trace?.mark("audio.capture-started")
                    return Started(sessionID: self.sessionID, startedAt: Date(), files: files)
                } catch MicrophoneStartError.notStarted {
                    guard attempt < delays.count else { throw MicrophoneStartError.notStarted }
                    trace?.mark("audio.retry-wait")
                    try await Task.sleep(for: delays[attempt])
                }
            }
            throw MicrophoneStartError.notStarted
        } catch {
            trace?.mark(error is CancellationError ? "audio.start-cancelled" : "audio.start-failed")
            if token == requestedToken {
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

    func interruptionEnded(token expectedToken: UUID, shouldResume: Bool) throws -> [URL] {
        guard token == expectedToken, interrupted, shouldResume, let device else { return files }
        try device.activate()
        try startSegment(using: device)
        interrupted = false
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
    func configure(mixWithOtherAudio: Bool, trace: RecordingStartupTrace?) throws {
        try configure(mixWithOtherAudio: mixWithOtherAudio)
    }
    func start(url: URL, trace: RecordingStartupTrace?) throws { try start(url: url) }
}

private final class LiveAudioCaptureDevice: AudioCaptureDevice {
    private var recorder: AVAudioRecorder?
    private var bluetoothInputUID: String?
    private var recorderPrepared = false

    func configure(mixWithOtherAudio: Bool) throws { try configure(mixWithOtherAudio: mixWithOtherAudio, trace: nil) }

    func configure(mixWithOtherAudio: Bool, trace: RecordingStartupTrace?) throws {
        let session = AVAudioSession.sharedInstance()
        var options: AVAudioSession.CategoryOptions = [.allowBluetoothHFP]
        if mixWithOtherAudio { options.insert(.mixWithOthers) }
        trace?.mark("audio.category-begin")
        try session.setCategory(.playAndRecord, mode: .default, options: options)
        trace?.mark("audio.category-end")
        trace?.mark("audio.activation-begin")
        try session.setActive(true)
        trace?.mark("audio.activation-end")
        let input = session.currentRoute.inputs.first
        bluetoothInputUID = input?.portType == .bluetoothHFP ? input?.uid : nil
        if let input, bluetoothInputUID != nil { try session.setPreferredInput(input) }
    }

    func activate() throws { try AVAudioSession.sharedInstance().setActive(true) }

    func start(url: URL) throws { try start(url: url, trace: nil) }

    func start(url: URL, trace: RecordingStartupTrace?) throws {
        if let bluetoothInputUID,
           AVAudioSession.sharedInstance().currentRoute.inputs.first?.uid != bluetoothInputUID {
            throw SpeechTranscriptionEngineError(message: "The Bluetooth microphone disconnected. Try recording again.")
        }
        if recorder?.url != url { try prepare(url: url, readyToRecord: true, trace: trace) }
        guard let recorder else { throw MicrophoneStartError.notStarted }
        if !recorderPrepared {
            trace?.mark("audio.prepare-to-record-begin")
            let prepared = recorder.prepareToRecord()
            trace?.mark("audio.prepare-to-record-end")
            guard prepared else { throw MicrophoneStartError.notStarted }
            recorderPrepared = true
        }
        trace?.mark("audio.record-call-begin")
        let recording = recorder.record()
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
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        trace?.mark("audio.recorder-allocation-end")
        recorder.isMeteringEnabled = true
        self.recorder = recorder
        recorderPrepared = false
        // AVFoundation can activate sessions automatically. Never call this
        // before the first explicit recording has activated our session.
        if readyToRecord {
            trace?.mark("audio.prepare-to-record-begin")
            let prepared = recorder.prepareToRecord()
            trace?.mark("audio.prepare-to-record-end")
            guard prepared else { throw MicrophoneStartError.notStarted }
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
