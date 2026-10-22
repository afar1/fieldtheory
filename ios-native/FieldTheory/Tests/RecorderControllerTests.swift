import XCTest
@testable import FieldTheory

@MainActor
private final class RecorderTestSpeechEngine: SpeechTranscriptionEngine {
    let runtimeIdentity: String
    var state: SpeechEngineState
    var onStateChange: (() -> Void)?
    private(set) var downloadCalls = 0
    private(set) var prepareCalls = 0
    private(set) var cancelPreparationCalls = 0
    private(set) var transcribeCalls = 0
    var result: Result<String, Error>
    var preparation: (() async throws -> Void)?
    var beforeTranscribe: (() async -> Void)?

    init(
        identity: String = "test.parakeet/model-v2",
        state: SpeechEngineState,
        result: Result<String, Error> = .success("fixture transcript")
    ) {
        self.runtimeIdentity = identity
        self.state = state
        self.result = result
    }

    func ensureDownloaded() { downloadCalls += 1 }

    func prepare() async throws {
        prepareCalls += 1
        try await preparation?()
        state = .ready
        onStateChange?()
    }

    func cancelPreparation() { cancelPreparationCalls += 1 }

    func transcribe(audioURL: URL) async throws -> String {
        transcribeCalls += 1
        await beforeTranscribe?()
        return try result.get()
    }
}

private actor RecorderPreparationGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var isOpen = false

    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { continuation = $0 }
    }

    func release() {
        isOpen = true
        continuation?.resume()
        continuation = nil
    }
}

private final class ColdCaptureDevice: AudioCaptureDevice, @unchecked Sendable {
    private var currentURL: URL?
    func prepare(url: URL, readyToRecord: Bool) throws { try Data().write(to: url) }
    func configure(mixWithOtherAudio: Bool) throws {}
    func activate() throws {}
    func start(url: URL) throws {
        currentURL = url
        try Data("recording".utf8).write(to: url)
    }
    func stop() { currentURL = nil }
    func deactivate() {}
    func sample() -> AudioCaptureOwner.Sample? {
        .init(level: 0, isRecording: currentURL != nil, recordedSeconds: 1)
    }
}

@MainActor
private func waitForRecorderCondition(
    _ condition: @escaping @MainActor () -> Bool,
    attempts: Int = 200
) async -> Bool {
    for _ in 0..<attempts {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(5))
    }
    return condition()
}

final class RecorderControllerTests: XCTestCase {
    @MainActor
    func testAutoSendChangeDuringTranscriptionAppliesToCurrentSession() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("ft-current-send-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let sessionID = "100"
        try Data("audio".utf8).write(to: dir.appendingPathComponent("rec-\(sessionID)-0.wav"))
        let gate = RecorderPreparationGate()
        let engine = RecorderTestSpeechEngine(state: .ready)
        engine.beforeTranscribe = { await gate.wait() }
        let recorder = RecorderController(pendingDirectory: dir, speechEngine: engine)
        var deliveredAction: RecordingFinishAction?
        recorder.onTranscript = { _ in
            deliveredAction = recorder.finishAction(for: recorder.currentDeliverySessionID)
            return true
        }
        recorder.setWorkEnabled(true)
        let work = Task { await recorder.resumePendingWork() }
        let started = await waitForRecorderCondition { recorder.transcribingSessionID == sessionID }
        XCTAssertTrue(started)
        recorder.setCurrentTranscriptionAutoSend(true)
        await gate.release()
        await work.value
        XCTAssertEqual(deliveredAction, .send)
        XCTAssertNil(recorder.transcribingSessionID)
    }

    @MainActor
    func testAutoSendChangeDuringRecordingAppliesToCurrentSession() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let engine = RecorderTestSpeechEngine(state: .notDownloaded)
        let recorder = RecorderController(pendingDirectory: root, speechEngine: engine,
            captureOwner: AudioCaptureOwner(makeDevice: { ColdCaptureDevice() }))
        recorder.setWorkEnabled(true)
        await recorder.beginSession()
        let id = try XCTUnwrap(recorder.activeRecordingID)
        recorder.setCurrentTranscriptionAutoSend(true)
        XCTAssertEqual(recorder.finishAction(for: id), .send)
        recorder.setCurrentTranscriptionAutoSend(false)
        XCTAssertEqual(recorder.finishAction(for: id), .stop)
        recorder.setCurrentTranscriptionAutoSend(true)
        await recorder.stopAndTranscribe()
        XCTAssertEqual(recorder.finishAction(for: id), .send)
        XCTAssertEqual(recorder.pendingSessionCount, 1)
    }

    @MainActor
    func testColdVoiceModelDoesNotBlockRecordingAndQueuesMultipleCaptures() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let engine = RecorderTestSpeechEngine(state: .notDownloaded)
        let device = ColdCaptureDevice()
        let recorder = RecorderController(pendingDirectory: root, speechEngine: engine,
                                          captureOwner: AudioCaptureOwner(makeDevice: { device }))
        recorder.setWorkEnabled(true)
        XCTAssertTrue(recorder.canStartRecording)
        for expectedCount in 1...2 {
            await recorder.beginSession()
            XCTAssertEqual(recorder.phase, .recording)
            await recorder.stopAndTranscribe()
            XCTAssertEqual(recorder.phase, .idle)
            XCTAssertEqual(recorder.pendingSessionCount, expectedCount)
            XCTAssertTrue(recorder.canStartRecording)
        }
        XCTAssertEqual(engine.transcribeCalls, 0)
        XCTAssertEqual(RecorderController.pendingSessions(in: root).count, 2)
    }

    @MainActor
    func testFailedQueuedRecordingDoesNotBlockLaterTranscription() async throws {
        struct DamagedAudio: Error {}
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let suite = "PendingErrorTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        try Data("damaged".utf8).write(to: root.appendingPathComponent("rec-100-0.wav"))
        try Data("good".utf8).write(to: root.appendingPathComponent("rec-200-0.wav"))
        let recorder = RecorderController(pendingDirectory: root, defaults: defaults, transcribe: { url in
            if url.lastPathComponent == "rec-100-0.wav" { throw DamagedAudio() }
            return "later recording"
        })
        var delivered: [String] = []
        recorder.onTranscript = { text in delivered.append(text); return true }
        recorder.setWorkEnabled(true)
        await recorder.drainPendingQueue()
        XCTAssertEqual(delivered, ["later recording"])
        XCTAssertEqual(recorder.pendingSessionCount, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("rec-100-0.wav").path))
        let pending = try XCTUnwrap(recorder.nextPendingSession)
        XCTAssertNotNil(recorder.pendingError(for: pending))
        let restored = RecorderController(pendingDirectory: root, defaults: defaults,
            transcribe: { _ in "recovered recording" })
        XCTAssertNotNil(restored.pendingError(for: pending), "Failure details must survive app relaunch")
        restored.onTranscript = { _ in true }
        restored.setWorkEnabled(true)
        await restored.drainPendingQueue()
        XCTAssertNil(restored.pendingError(for: pending))
    }


    @MainActor
    func testBackgroundPreparationDoesNotDownloadOrRecord() async {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let engine = RecorderTestSpeechEngine(state: .notDownloaded)
        let recorder = RecorderController(pendingDirectory: root, speechEngine: engine)
        recorder.setWorkEnabled(true)
        let result = await recorder.prepareVoiceModelInBackground()
        XCTAssertFalse(result)
        XCTAssertEqual(engine.downloadCalls, 0)
        XCTAssertEqual(engine.prepareCalls, 0)
        XCTAssertEqual(engine.transcribeCalls, 0)
        XCTAssertEqual(recorder.phase, .idle)
        XCTAssertNil(recorder.startedAt)
    }

    @MainActor
    func testBackgroundPreparationHonorsDisabledWorkspace() async {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let engine = RecorderTestSpeechEngine(state: .preparing)
        let recorder = RecorderController(pendingDirectory: root, speechEngine: engine)
        let result = await recorder.prepareVoiceModelInBackground()
        XCTAssertFalse(result)
        XCTAssertEqual(engine.prepareCalls, 0)
    }


    @MainActor
    func testDiscardOnlyConfirmedSessionAndRejectStaleConfirmation() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        for name in ["rec-100-0.wav", "rec-100-1.wav", "rec-200-0.wav"] {
            try Data("audio".utf8).write(to: dir.appendingPathComponent(name))
        }
        let recorder = RecorderController(pendingDirectory: dir)
        let confirmed = try XCTUnwrap(recorder.nextPendingSession)
        recorder.discardPendingSession(confirmed)
        XCTAssertEqual(recorder.pendingSessionCount, 1)
        XCTAssertEqual(recorder.nextPendingSession?.id, "200")
        recorder.discardPendingSession(confirmed)
        XCTAssertEqual(recorder.pendingSessionCount, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("rec-200-0.wav").path))
    }

    func testPendingSessionsGroupAndSortRecordingSegments() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-pending-audio-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        for name in ["rec-200-10.wav", "rec-100-1.wav", "rec-100-0.wav", "note.txt", "loose.wav"] {
            FileManager.default.createFile(atPath: dir.appendingPathComponent(name).path, contents: Data())
        }

        let sessions = RecorderController.pendingSessions(in: dir)

        XCTAssertEqual(sessions.map(\.id), ["100", "200", "loose"])
        XCTAssertEqual(sessions[0].files.map(\.lastPathComponent), ["rec-100-0.wav", "rec-100-1.wav"])
        XCTAssertEqual(sessions[1].files.map(\.lastPathComponent), ["rec-200-10.wav"])
        XCTAssertEqual(sessions[2].files.map(\.lastPathComponent), ["loose.wav"])
    }

    @MainActor
    func testParakeetNeverDownloadsUntilExplicitActionAndKeepsAudioQueued() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-engine-queue-\(UUID().uuidString)")
        let dir = root.appendingPathComponent("pending")
        let fixture = root.appendingPathComponent("fixture.wav")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("audio".utf8).write(to: fixture)
        defer { try? FileManager.default.removeItem(at: root) }
        let engine = RecorderTestSpeechEngine(state: .notDownloaded)
        let recorder = RecorderController(pendingDirectory: dir, speechEngine: engine)
        recorder.onTranscript = { _ in true }
        recorder.setWorkEnabled(true)

        try recorder.enqueueAudioFixtureForBenchmark(fixture)
        await recorder.resumePendingWork()

        XCTAssertEqual(engine.downloadCalls, 0)
        XCTAssertEqual(engine.prepareCalls, 0)
        XCTAssertEqual(engine.transcribeCalls, 0)
        XCTAssertEqual(recorder.pendingSessionCount, 1)

        recorder.downloadSpeechEngine()
        XCTAssertEqual(engine.downloadCalls, 1)
    }

    @MainActor
    func testCachedParakeetPreparesOnceWithoutClaimingTranscription() async {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-engine-prepare-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let gate = RecorderPreparationGate()
        let engine = RecorderTestSpeechEngine(state: .preparing)
        engine.preparation = { await gate.wait() }
        let recorder = RecorderController(pendingDirectory: dir, speechEngine: engine)

        recorder.setWorkEnabled(true)
        let started = await waitForRecorderCondition { engine.prepareCalls == 1 }
        XCTAssertTrue(started)
        XCTAssertEqual(recorder.phase, .idle)
        XCTAssertEqual(recorder.engineState, .preparing)

        await recorder.resumePendingWork()
        engine.onStateChange?()
        try? await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(engine.prepareCalls, 1)
        XCTAssertEqual(engine.transcribeCalls, 0)
        XCTAssertEqual(engine.downloadCalls, 0)

        await gate.release()
        let becameReady = await waitForRecorderCondition { recorder.engineState == .ready }
        XCTAssertTrue(becameReady)
    }

    @MainActor
    func testForegroundResumeRecoversQueuedAudioAfterLocalPreparationFailure() async throws {
        struct PreparationInterrupted: Error {}
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-prepare-recovery-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = root.appendingPathComponent("fixture.wav")
        try Data("audio".utf8).write(to: fixture)
        let engine = RecorderTestSpeechEngine(state: .preparing)
        engine.preparation = {
            engine.state = .failed("interrupted local preparation")
            engine.onStateChange?()
            throw PreparationInterrupted()
        }
        let recorder = RecorderController(
            pendingDirectory: root.appendingPathComponent("pending"), speechEngine: engine)
        var delivered: [String] = []
        recorder.onTranscript = { delivered.append($0); return true }
        try recorder.enqueueAudioFixtureForBenchmark(fixture)
        recorder.setWorkEnabled(true)
        let failed = await waitForRecorderCondition { recorder.lastError != nil }
        XCTAssertTrue(failed)
        XCTAssertEqual(recorder.pendingSessionCount, 1)
        XCTAssertTrue(delivered.isEmpty)

        // Repeated state notifications must not turn one failure into a loop.
        engine.onStateChange?()
        await Task.yield()
        XCTAssertEqual(engine.prepareCalls, 1)

        engine.preparation = nil
        await recorder.resumePendingWork()
        let recovered = await waitForRecorderCondition { recorder.pendingSessionCount == 0 }
        XCTAssertTrue(recovered)
        XCTAssertEqual(delivered, ["fixture transcript"])
        XCTAssertNil(recorder.lastError)
        XCTAssertEqual(engine.downloadCalls, 0)
    }

    @MainActor
    func testSignedOutRecorderDoesNotPrepareCachedEngine() async {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-engine-signed-out-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let engine = RecorderTestSpeechEngine(state: .preparing)
        let recorder = RecorderController(pendingDirectory: dir, speechEngine: engine)

        await recorder.resumePendingWork()
        engine.onStateChange?()
        try? await Task.sleep(for: .milliseconds(30))

        XCTAssertEqual(engine.prepareCalls, 0)
        XCTAssertEqual(engine.downloadCalls, 0)
        XCTAssertEqual(recorder.phase, .idle)
    }

    @MainActor
    func testDisablingWorkCancelsPreparationWaiterWithoutStartingAnother() async {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-engine-cancel-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let gate = RecorderPreparationGate()
        let engine = RecorderTestSpeechEngine(state: .preparing)
        engine.preparation = { await gate.wait() }
        let recorder = RecorderController(pendingDirectory: dir, speechEngine: engine)
        recorder.setWorkEnabled(true)
        let started = await waitForRecorderCondition { engine.prepareCalls == 1 }
        XCTAssertTrue(started)

        recorder.setWorkEnabled(false)
        XCTAssertEqual(engine.cancelPreparationCalls, 1)
        await gate.release()
        try? await Task.sleep(for: .milliseconds(30))

        XCTAssertEqual(engine.prepareCalls, 1)
        XCTAssertEqual(engine.transcribeCalls, 0)
        XCTAssertEqual(recorder.phase, .idle)
    }

    @MainActor
    func testLegacyWhisperBindingMigratesAndDrainsThroughParakeetAfterRelaunch() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-engine-migrate-\(UUID().uuidString)")
        let dir = root.appendingPathComponent("pending")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("audio".utf8).write(to: dir.appendingPathComponent("rec-100-0.wav"))
        try Data(#"{"schemaVersion":1,"engine":"whisper"}"#.utf8)
            .write(to: dir.appendingPathComponent("rec-100.engine.json"))

        let engine = RecorderTestSpeechEngine(state: .ready)
        let recorder = RecorderController(pendingDirectory: dir, speechEngine: engine)
        let migrated = try JSONSerialization.jsonObject(
            with: Data(contentsOf: dir.appendingPathComponent("rec-100.engine.json"))
        ) as? [String: Any]
        XCTAssertEqual(migrated?["schemaVersion"] as? Int, 2)
        XCTAssertEqual(migrated?["engine"] as? String, "parakeet")
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("rec-100-0.wav").path))

        var delivered: [String] = []
        recorder.onTranscript = { text in delivered.append(text); return true }
        recorder.setWorkEnabled(true)
        await recorder.resumePendingWork()

        XCTAssertEqual(engine.transcribeCalls, 1)
        XCTAssertEqual(delivered, ["fixture transcript"])
        XCTAssertEqual(recorder.pendingSessionCount, 0)
    }

    @MainActor
    func testUntaggedLegacyQueueGetsParakeetBindingWithoutMovingAudio() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-engine-untagged-\(UUID().uuidString)")
        let dir = root.appendingPathComponent("pending")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let audio = dir.appendingPathComponent("rec-200-0.wav")
        try Data("audio".utf8).write(to: audio)

        _ = RecorderController(
            pendingDirectory: dir,
            speechEngine: RecorderTestSpeechEngine(state: .notDownloaded)
        )

        XCTAssertTrue(FileManager.default.fileExists(atPath: audio.path))
        let sidecar = try Data(contentsOf: dir.appendingPathComponent("rec-200.engine.json"))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: sidecar) as? [String: Any])
        XCTAssertEqual(object["engine"] as? String, "parakeet")
        XCTAssertEqual(object["schemaVersion"] as? Int, 2)
    }

    @MainActor
    func testParakeetFailurePreservesAudioAndBindingForRetry() async throws {
        struct ExpectedFailure: LocalizedError { var errorDescription: String? { "expected failure" } }
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-engine-failure-\(UUID().uuidString)")
        let dir = root.appendingPathComponent("pending")
        let fixture = root.appendingPathComponent("fixture.wav")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("audio".utf8).write(to: fixture)
        defer { try? FileManager.default.removeItem(at: root) }
        let engine = RecorderTestSpeechEngine(state: .ready, result: .failure(ExpectedFailure()))
        let recorder = RecorderController(pendingDirectory: dir, speechEngine: engine)
        recorder.onTranscript = { _ in XCTFail("Failed audio was delivered"); return false }
        recorder.setWorkEnabled(true)

        try recorder.enqueueAudioFixtureForBenchmark(fixture)
        await recorder.resumePendingWork()

        XCTAssertEqual(engine.transcribeCalls, 1)
        XCTAssertEqual(recorder.pendingSessionCount, 1)
        XCTAssertTrue(recorder.lastError?.contains("Parakeet transcription failed") == true)
        let sidecars = (try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: nil
        ).filter { $0.lastPathComponent.hasSuffix(".engine.json") }) ?? []
        XCTAssertEqual(sidecars.count, 1)

        engine.result = .success("retried transcript")
        var delivered: [String] = []
        recorder.onTranscript = { delivered.append($0); return true }
        await recorder.resumePendingWork()
        XCTAssertEqual(delivered, ["retried transcript"])
        XCTAssertEqual(engine.transcribeCalls, 2)
        XCTAssertEqual(recorder.phase, .idle)
        XCTAssertNil(recorder.nextPendingSession)
        XCTAssertNil(recorder.lastError)
    }

    @MainActor
    func testBenchmarkFixtureEmitsContentFreeParakeetTimingEvidence() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-engine-metrics-\(UUID().uuidString)")
        let dir = root.appendingPathComponent("pending")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = root.appendingPathComponent("fixture.wav")
        try Data(repeating: 7, count: 512).write(to: fixture)
        let engine = RecorderTestSpeechEngine(state: .ready)
        let recorder = RecorderController(
            pendingDirectory: dir,
            metricsDirectory: root.appendingPathComponent("diagnostics"),
            speechEngine: engine
        )
        recorder.onTranscript = { _ in true }
        recorder.setWorkEnabled(true)

        _ = try recorder.enqueueAudioFixtureForBenchmark(fixture)
        await recorder.resumePendingWork()
        let metrics = try XCTUnwrap(recorder.lastTranscriptionMetrics)

        XCTAssertEqual(metrics.engineIdentity, "test.parakeet/model-v2")
        XCTAssertEqual(metrics.segmentCount, 1)
        XCTAssertEqual(metrics.audioBytes, 512)
        XCTAssertEqual(metrics.runtimePreparedBeforeInference, true)
        let json = try recorder.lastTranscriptionMetricsJSON()
        XCTAssertNil((try JSONSerialization.jsonObject(with: json) as? [String: Any])?["text"])
        XCTAssertFalse(String(decoding: json, as: UTF8.self).contains("fixture transcript"))
    }
}
