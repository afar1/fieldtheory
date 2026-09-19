import XCTest
@testable import FieldTheory

private final class FakeCaptureDevice: AudioCaptureDevice, @unchecked Sendable {
    var refuseFirstStart = false
    var onStart: (() -> Void)?
    var onStop: (() -> Void)?
    var stopGate: DispatchSemaphore?
    var startError: Error?
    private(set) var startCalls = 0
    private(set) var configureCalls = 0
    private(set) var stopCalls = 0
    private(set) var prepareCalls = 0
    private(set) var fullyPreparedCalls = 0
    private(set) var deactivateCalls = 0
    private(set) var preparedURL: URL?
    var preparationError: Error?

    func prepare(url: URL, readyToRecord: Bool, evidence: AudioCaptureOwner.Evidence) throws {
        XCTAssertFalse(Thread.isMainThread)
        prepareCalls += 1
        if readyToRecord { fullyPreparedCalls += 1 }
        preparedURL = url
        try Data().write(to: url)
        if let preparationError { throw preparationError }
    }
    private var currentURL: URL?

    func configure(mixWithOtherAudio: Bool, evidence: AudioCaptureOwner.Evidence) throws {
        XCTAssertFalse(Thread.isMainThread, "Audio configuration must not block UI rendering")
        configureCalls += 1
    }
    func activate() throws { XCTAssertFalse(Thread.isMainThread) }
    func start(url: URL, evidence: AudioCaptureOwner.Evidence) throws {
        XCTAssertFalse(Thread.isMainThread, "Recorder startup must not block UI rendering")
        startCalls += 1
        onStart?()
        if let startError { throw startError }
        if refuseFirstStart && startCalls == 1 { throw MicrophoneStartError.notStarted }
        currentURL = url
        try Data("unsealed".utf8).write(to: url)
    }
    func stop() {
        XCTAssertFalse(Thread.isMainThread)
        stopCalls += 1
        onStop?()
        stopGate?.wait()
        stopGate = nil
        if let currentURL { try? Data("sealed".utf8).write(to: currentURL) }
        currentURL = nil
    }
    func deactivate() { XCTAssertFalse(Thread.isMainThread); deactivateCalls += 1 }
    func sample() -> AudioCaptureOwner.Sample? {
        .init(level: 0.5, isRecording: currentURL != nil, recordedSeconds: 1)
    }
}

final class AudioCaptureOwnerTests: XCTestCase {
    func testPreparationNeverCapturesAndOnlyFullyPreparesAfterExplicitStart() async throws {
        let device = FakeCaptureDevice()
        let owner = AudioCaptureOwner(makeDevice: { device })
        await owner.setPreparationEnabled(true, revision: 1)
        XCTAssertEqual(device.prepareCalls, 1)
        XCTAssertEqual(device.fullyPreparedCalls, 0)
        XCTAssertEqual(device.configureCalls, 0)
        XCTAssertEqual(device.startCalls, 0)
        let firstToken = UUID()
        let first = try await owner.start(token: firstToken, sessionID: 910_001,
            mixWithOtherAudio: false, evidence: { _, _, _ in })
        let firstFiles = await owner.stop(token: firstToken)
        XCTAssertEqual(device.prepareCalls, 1, "Stop must return sealed files without waiting for preparation")
        await owner.setPreparationEnabled(true, revision: 2)
        XCTAssertEqual(device.fullyPreparedCalls, 1)
        let secondToken = UUID()
        let second = try await owner.start(token: secondToken, sessionID: 910_002,
            mixWithOtherAudio: false, evidence: { _, _, _ in })
        let secondFiles = await owner.stop(token: secondToken)
        XCTAssertEqual(device.configureCalls, 1)
        XCTAssertNotEqual(first.sessionID, second.sessionID)
        XCTAssertEqual(firstFiles.first?.lastPathComponent, "rec-\(first.sessionID)-0.wav")
        XCTAssertEqual(secondFiles.first?.lastPathComponent, "rec-\(second.sessionID)-0.wav")
        await owner.setPreparationEnabled(false, revision: 3)
        XCTAssertEqual(device.deactivateCalls, 1)
        for file in firstFiles + secondFiles { try? FileManager.default.removeItem(at: file) }
    }

    func testStalePreparationCannotReopenReleasedResources() async throws {
        let device = FakeCaptureDevice()
        let owner = AudioCaptureOwner(makeDevice: { device })
        await owner.setPreparationEnabled(true, revision: 1)
        let scratch = try XCTUnwrap(device.preparedURL)
        await owner.setPreparationEnabled(false, revision: 3)
        await owner.setPreparationEnabled(true, revision: 2)
        XCTAssertEqual(device.prepareCalls, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: scratch.path))
        XCTAssertEqual(device.startCalls, 0)
    }

    func testBackgroundingPreservesActiveCaptureAndReleasesOnStop() async throws {
        let device = FakeCaptureDevice()
        let owner = AudioCaptureOwner(makeDevice: { device })
        await owner.setPreparationEnabled(true, revision: 1)
        let token = UUID()
        _ = try await owner.start(token: token, sessionID: 910_003,
            mixWithOtherAudio: false, evidence: { _, _, _ in })
        await owner.setPreparationEnabled(false, revision: 2)
        let sample = await owner.sample(token: token)
        XCTAssertEqual(sample?.isRecording, true)
        XCTAssertEqual(device.deactivateCalls, 0)
        let files = await owner.stop(token: token)
        XCTAssertEqual(device.deactivateCalls, 1)
        for file in files { try? FileManager.default.removeItem(at: file) }
    }

    func testWarmInterruptionSegmentsKeepAdoptedSessionIdentity() async throws {
        let device = FakeCaptureDevice()
        let owner = AudioCaptureOwner(makeDevice: { device })
        await owner.setPreparationEnabled(true, revision: 1)
        let token = UUID()
        let started = try await owner.start(token: token, sessionID: 910_004,
            mixWithOtherAudio: false, evidence: { _, _, _ in })
        await owner.interruptionBegan(token: token)
        _ = try await owner.interruptionEnded(token: token, shouldResume: true)
        let files = await owner.stop(token: token)
        XCTAssertEqual(files.map(\.lastPathComponent), ["rec-\(started.sessionID)-0.wav", "rec-\(started.sessionID)-1.wav"])
        for file in files { try? FileManager.default.removeItem(at: file) }
    }

    func testPreparationFailureDeletesScratchAndFallsBackToColdStart() async throws {
        let device = FakeCaptureDevice()
        device.preparationError = NSError(domain: "prepare-test", code: 1)
        let owner = AudioCaptureOwner(makeDevice: { device })
        await owner.setPreparationEnabled(true, revision: 1)
        let scratch = try XCTUnwrap(device.preparedURL)
        XCTAssertFalse(FileManager.default.fileExists(atPath: scratch.path))
        let token = UUID()
        let started = try await owner.start(token: token, sessionID: 910_005,
            mixWithOtherAudio: false, evidence: { _, _, _ in })
        XCTAssertEqual(started.sessionID, 910_005)
        let files = await owner.stop(token: token)
        await owner.setPreparationEnabled(false, revision: 2)
        for file in files { try? FileManager.default.removeItem(at: file) }
    }

    func testRouteInvalidationAndMixChangeCannotReuseStaleSession() async throws {
        let device = FakeCaptureDevice()
        let owner = AudioCaptureOwner(makeDevice: { device })
        await owner.setPreparationEnabled(true, revision: 1)
        let token = UUID()
        _ = try await owner.start(token: token, sessionID: 910_006,
            mixWithOtherAudio: false, evidence: { _, _, _ in })
        var files = await owner.stop(token: token)
        await owner.setPreparationEnabled(true, revision: 2)
        await owner.invalidatePreparation()
        let next = UUID()
        _ = try await owner.start(token: next, sessionID: 910_007,
            mixWithOtherAudio: true, evidence: { _, _, _ in })
        files += await owner.stop(token: next)
        XCTAssertEqual(device.configureCalls, 2)
        await owner.setPreparationEnabled(false, revision: 3)
        for file in files { try? FileManager.default.removeItem(at: file) }
    }

    func testIntentMixPolicyReconfiguresWarmForegroundSession() async throws {
        let device = FakeCaptureDevice()
        let owner = AudioCaptureOwner(makeDevice: { device })
        await owner.setPreparationEnabled(true, revision: 1)
        let first = UUID()
        _ = try await owner.start(token: first, sessionID: 910_008,
            mixWithOtherAudio: false, evidence: { _, _, _ in })
        var files = await owner.stop(token: first)
        await owner.setPreparationEnabled(true, revision: 2)
        let second = UUID()
        _ = try await owner.start(token: second, sessionID: 910_009,
            mixWithOtherAudio: true, evidence: { _, _, _ in })
        files += await owner.stop(token: second)
        XCTAssertEqual(device.configureCalls, 2)
        await owner.setPreparationEnabled(false, revision: 3)
        for file in files { try? FileManager.default.removeItem(at: file) }
    }

    func testCancelledWarmRetryDoesNotRestartOrLeakPreparedFile() async throws {
        let device = FakeCaptureDevice()
        device.refuseFirstStart = true
        let owner = AudioCaptureOwner(makeDevice: { device })
        await owner.setPreparationEnabled(true, revision: 1)
        let scratch = try XCTUnwrap(device.preparedURL)
        let attempted = expectation(description: "prepared start refused")
        device.onStart = { attempted.fulfill() }
        let token = UUID()
        let startup = Task {
            try await owner.start(token: token, sessionID: 910_010,
                mixWithOtherAudio: false, evidence: { _, _, _ in })
        }
        await fulfillment(of: [attempted], timeout: 2)
        _ = await owner.stop(token: token)
        await owner.setPreparationEnabled(false, revision: 2)
        do {
            _ = try await startup.value
            XCTFail("Cancelled prepared capture restarted")
        } catch is CancellationError { }
        XCTAssertEqual(device.startCalls, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: scratch.path))
    }

    func testCancelledRetryCannotResurrectCapture() async throws {
        let device = FakeCaptureDevice()
        device.refuseFirstStart = true
        let firstAttempt = expectation(description: "first start refused")
        device.onStart = { firstAttempt.fulfill() }
        let owner = AudioCaptureOwner(makeDevice: { device })
        let token = UUID()
        let startup = Task {
            try await owner.start(token: token, sessionID: 900_001,
                mixWithOtherAudio: true, evidence: { _, _, _ in })
        }
        await fulfillment(of: [firstAttempt], timeout: 2)
        let files = await owner.stop(token: token)
        XCTAssertTrue(files.isEmpty)
        do {
            _ = try await startup.value
            XCTFail("Cancelled retry restarted capture")
        } catch is CancellationError { }
        XCTAssertEqual(device.startCalls, 1)
        let sample = await owner.sample(token: token)
        XCTAssertNil(sample)
    }

    func testStopBeforeStartInvalidatesQueuedAttempt() async throws {
        let device = FakeCaptureDevice()
        let owner = AudioCaptureOwner(makeDevice: { device })
        let token = UUID()
        _ = await owner.stop(token: token)
        do {
            _ = try await owner.start(token: token, sessionID: 900_002,
                mixWithOtherAudio: false, evidence: { _, _, _ in })
            XCTFail("An invalidated attempt started")
        } catch is CancellationError { }
        XCTAssertEqual(device.configureCalls, 0)
    }

    func testStopSealsFilesBeforeReturningAndStaleStopCannotStopNextCapture() async throws {
        let device = FakeCaptureDevice()
        let owner = AudioCaptureOwner(makeDevice: { device })
        let first = UUID()
        _ = try await owner.start(token: first, sessionID: 900_003,
            mixWithOtherAudio: false, evidence: { _, _, _ in })
        let files = await owner.stop(token: first)
        defer { for file in files { try? FileManager.default.removeItem(at: file) } }
        XCTAssertEqual(files.count, 1)
        XCTAssertEqual(try String(contentsOf: XCTUnwrap(files.first), encoding: .utf8), "sealed")
        let second = UUID()
        _ = try await owner.start(token: second, sessionID: 900_004,
            mixWithOtherAudio: false, evidence: { _, _, _ in })
        _ = await owner.stop(token: first)
        let sample = await owner.sample(token: second)
        XCTAssertEqual(sample?.isRecording, true)
        let secondFiles = await owner.stop(token: second)
        for file in secondFiles { try? FileManager.default.removeItem(at: file) }
    }

    func testInterruptionResumeKeepsBothSealedSegments() async throws {
        let device = FakeCaptureDevice()
        let owner = AudioCaptureOwner(makeDevice: { device })
        let token = UUID()
        _ = try await owner.start(token: token, sessionID: 900_005,
            mixWithOtherAudio: false, evidence: { _, _, _ in })
        await owner.interruptionBegan(token: token)
        _ = try await owner.interruptionEnded(token: token, shouldResume: true)
        let files = await owner.stop(token: token)
        defer { for file in files { try? FileManager.default.removeItem(at: file) } }
        XCTAssertEqual(files.count, 2)
        for file in files { XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "sealed") }
    }
    func testTransientRefusalRecoversOnOwnerRetry() async throws {
        let device = FakeCaptureDevice()
        device.refuseFirstStart = true
        let owner = AudioCaptureOwner(makeDevice: { device })
        let token = UUID()
        _ = try await owner.start(token: token, sessionID: 900_006,
            mixWithOtherAudio: true, evidence: { _, _, _ in })
        XCTAssertEqual(device.startCalls, 2)
        let files = await owner.stop(token: token)
        for file in files { try? FileManager.default.removeItem(at: file) }
    }

    func testNontransientErrorIsNotRetried() async throws {
        let device = FakeCaptureDevice()
        device.startError = NSError(domain: "capture-test", code: 42)
        let owner = AudioCaptureOwner(makeDevice: { device })
        do {
            _ = try await owner.start(token: UUID(), sessionID: 900_007,
                mixWithOtherAudio: false, evidence: { _, _, _ in })
            XCTFail("Expected nontransient error")
        } catch { XCTAssertEqual((error as NSError).code, 42) }
        XCTAssertEqual(device.startCalls, 1)
    }

    @MainActor
    func testSuspensionWaitsForStoppingCaptureAndPreservesSealedAudio() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let device = FakeCaptureDevice()
        let owner = AudioCaptureOwner(makeDevice: { device })
        let recorder = RecorderController(pendingDirectory: root,
            transcribe: { _ in XCTFail("Suspended capture must not transcribe"); return "" }, captureOwner: owner)
        recorder.setWorkEnabled(true)
        await recorder.beginSession()
        XCTAssertEqual(recorder.phase, .recording)
        let sealEntered = expectation(description: "sealing capture")
        device.onStop = { sealEntered.fulfill() }
        let gate = DispatchSemaphore(value: 0)
        device.stopGate = gate
        recorder.onCaptureFinished = {
            XCTAssertFalse(recorder.canStartRecording, "A new capture must wait until the prior activity finishes")
        }
        let stopping = Task { await recorder.stopAndTranscribe() }
        await fulfillment(of: [sealEntered], timeout: 2)
        var suspensionFinished = false
        let suspending = Task { await recorder.suspendAndWait(); suspensionFinished = true }
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertFalse(suspensionFinished, "Suspension must await sealing before swapping stores")
        gate.signal()
        await suspending.value
        await stopping.value
        XCTAssertEqual(recorder.phase, .idle)
        XCTAssertNil(recorder.activeRecordingID)
        XCTAssertEqual(recorder.pendingSessionCount, 1)
        let file = try XCTUnwrap(recorder.nextPendingSession?.files.first)
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "sealed")
    }

    @MainActor
    func testDestructiveCleanupWaitsForStopThenDeletesAudio() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let device = FakeCaptureDevice()
        let recorder = RecorderController(pendingDirectory: root,
            transcribe: { _ in XCTFail("Discarded capture must not transcribe"); return "" },
            captureOwner: AudioCaptureOwner(makeDevice: { device }))
        recorder.setWorkEnabled(true)
        await recorder.beginSession()
        let sealEntered = expectation(description: "sealing capture")
        device.onStop = { sealEntered.fulfill() }
        let gate = DispatchSemaphore(value: 0)
        device.stopGate = gate
        let stopping = Task { await recorder.stopAndTranscribe() }
        await fulfillment(of: [sealEntered], timeout: 2)
        var cleanupFinished = false
        let cleanup = Task { try await recorder.discardRecordings(); cleanupFinished = true }
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertFalse(cleanupFinished)
        gate.signal()
        try await cleanup.value
        await stopping.value
        XCTAssertEqual(recorder.phase, .idle)
        XCTAssertNil(recorder.activeRecordingID)
        XCTAssertEqual(recorder.pendingSessionCount, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
    }

    @MainActor
    func testDiscardDoesNotReturnOrNotifyBeforeCaptureStops() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let device = FakeCaptureDevice()
        let recorder = RecorderController(pendingDirectory: root, transcribe: { _ in "" },
            captureOwner: AudioCaptureOwner(makeDevice: { device }))
        recorder.setWorkEnabled(true)
        await recorder.beginSession()
        let id = try XCTUnwrap(recorder.activeRecordingID)
        let sealEntered = expectation(description: "sealing discarded capture")
        device.onStop = { sealEntered.fulfill() }
        let gate = DispatchSemaphore(value: 0)
        device.stopGate = gate
        var didNotify = false
        var didReturn = false
        recorder.onCaptureCancelled = { didNotify = true }
        let discarding = Task { await recorder.discardActiveRecording(expectedID: id); didReturn = true }
        await fulfillment(of: [sealEntered], timeout: 2)
        XCTAssertFalse(didNotify)
        XCTAssertFalse(didReturn)
        gate.signal()
        await discarding.value
        XCTAssertTrue(didNotify)
        XCTAssertTrue(didReturn)
        XCTAssertEqual(recorder.phase, .idle)
        XCTAssertEqual(recorder.pendingSessionCount, 0)
    }

}
