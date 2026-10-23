import XCTest
import AVFAudio
@testable import FieldTheory

private final class FakeCaptureDevice: AudioCaptureDevice, @unchecked Sendable {
    var refuseFirstStart = false
    var onStart: (() -> Void)?
    var onStop: (() -> Void)?
    var stopGate: DispatchSemaphore?
    var startError: Error?
    var startErrors: [Error] = []
    var configureError: Error?
    var configureErrors: [Error] = []
    private(set) var startCalls = 0
    private(set) var configureCalls = 0
    private(set) var mixPolicies: [Bool] = []
    private(set) var stopCalls = 0
    private(set) var prepareCalls = 0
    private(set) var fullyPreparedCalls = 0
    private(set) var deactivateCalls = 0
    private(set) var preparedURL: URL?
    var preparationError: Error?

    func prepare(url: URL, readyToRecord: Bool) throws {
        XCTAssertFalse(Thread.isMainThread)
        prepareCalls += 1
        if readyToRecord { fullyPreparedCalls += 1 }
        preparedURL = url
        try Data().write(to: url)
        if let preparationError { throw preparationError }
    }
    private var currentURL: URL?

    func configure(mixWithOtherAudio: Bool) throws {
        XCTAssertFalse(Thread.isMainThread, "Audio configuration must not block UI rendering")
        configureCalls += 1
        mixPolicies.append(mixWithOtherAudio)
        if !configureErrors.isEmpty { throw configureErrors.removeFirst() }
        if let configureError { throw configureError }
    }
    func activate() throws { XCTAssertFalse(Thread.isMainThread) }
    func start(url: URL) throws {
        XCTAssertFalse(Thread.isMainThread, "Recorder startup must not block UI rendering")
        startCalls += 1
        onStart?()
        if !startErrors.isEmpty { throw startErrors.removeFirst() }
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
    func testTransientStartAfterActivationReacquiresSessionAndRecordsOnce() async throws {
        let device = FakeCaptureDevice()
        device.startErrors = [NSError(domain: NSOSStatusErrorDomain,
            code: AVAudioSession.ErrorCode.cannotStartRecording.rawValue)]
        let owner = AudioCaptureOwner(makeDevice: { device })
        let token = UUID()
        let started = try await owner.start(token: token, sessionID: 930_001, mixWithOtherAudio: true)
        XCTAssertEqual(device.configureCalls, 2, "A failed route must be reacquired before retry")
        XCTAssertEqual(device.deactivateCalls, 1)
        XCTAssertEqual(started.files.count, 1, "Only the successful attempt belongs to the recording")
        let sample = await owner.sample(token: token)
        XCTAssertEqual(sample?.isRecording, true)
        let files = await owner.stop(token: token)
        for file in files { try? FileManager.default.removeItem(at: file) }
    }

    func testOrderedPolicyChangeRestagesBeforeImmediateStart() async throws {
        let device = FakeCaptureDevice()
        let owner = AudioCaptureOwner(makeDevice: { device })
        await owner.setPreparationEnabled(true, revision: 1)
        let oldURL = try XCTUnwrap(device.preparedURL)
        let boundary = Timestamps.nowMs() + 100
        // Match the controller queue: later lifecycle work waits for policy work,
        // and immediate Record waits for the latest queued task.
        let policy = Task {
            await owner.setPreparationEnabled(true, revision: 2, afterPolicyChangeAt: boundary)
        }
        let lifecycle = Task {
            await policy.value
            await owner.setPreparationEnabled(true, revision: 3)
        }
        await lifecycle.value
        let token = UUID()
        let started = try await owner.start(token: token, sessionID: boundary)
        XCTAssertGreaterThan(started.sessionID, boundary)
        XCTAssertNotEqual(started.files.first, oldURL)
        XCTAssertFalse(FileManager.default.fileExists(atPath: oldURL.path))
        // A preference change during capture must preserve that recording.
        await owner.setPreparationEnabled(true, revision: 4, afterPolicyChangeAt: boundary + 1_000)
        let sample = await owner.sample(token: token)
        XCTAssertEqual(sample?.isRecording, true)
        let files = await owner.stop(token: token)
        await owner.setPreparationEnabled(false, revision: 5)
        for file in files { try? FileManager.default.removeItem(at: file) }
    }

    func testPreparationNeverCapturesOrReactivatesSessionBetweenRecordings() async throws {
        let device = FakeCaptureDevice()
        let owner = AudioCaptureOwner(makeDevice: { device })
        await owner.setPreparationEnabled(true, revision: 1)
        XCTAssertEqual(device.prepareCalls, 1)
        XCTAssertEqual(device.fullyPreparedCalls, 0)
        XCTAssertEqual(device.configureCalls, 0)
        XCTAssertEqual(device.startCalls, 0)
        let firstToken = UUID()
        let first = try await owner.start(token: firstToken, sessionID: 910_001)
        let firstFiles = await owner.stop(token: firstToken)
        XCTAssertEqual(device.prepareCalls, 1, "Stop must return sealed files without waiting for preparation")
        XCTAssertEqual(device.deactivateCalls, 1, "Stop must release audio while preparation stays enabled")
        await owner.setPreparationEnabled(true, revision: 2)
        XCTAssertEqual(device.fullyPreparedCalls, 0, "Idle preparation must not reactivate audio")
        let secondToken = UUID()
        let second = try await owner.start(token: secondToken, sessionID: 910_002, mixWithOtherAudio: true)
        let secondFiles = await owner.stop(token: secondToken)
        XCTAssertEqual(device.configureCalls, 2, "Each recording must reactivate its session")
        XCTAssertEqual(device.mixPolicies, [false, true], "Background capture must use the requested mixing policy")
        XCTAssertNotEqual(first.sessionID, second.sessionID)
        XCTAssertEqual(firstFiles.first?.lastPathComponent, "rec-\(first.sessionID)-0.wav")
        XCTAssertEqual(secondFiles.first?.lastPathComponent, "rec-\(second.sessionID)-0.wav")
        XCTAssertEqual(device.deactivateCalls, 2)
        await owner.setPreparationEnabled(false, revision: 3)
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
        _ = try await owner.start(token: token, sessionID: 910_003)
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
        let started = try await owner.start(token: token, sessionID: 910_004)
        await owner.interruptionBegan(token: token)
        _ = try await owner.interruptionEnded(token: token, shouldResume: true)
        let files = await owner.stop(token: token)
        XCTAssertEqual(files.map(\.lastPathComponent), ["rec-\(started.sessionID)-0.wav", "rec-\(started.sessionID)-1.wav"])
        for file in files { try? FileManager.default.removeItem(at: file) }
    }

    func testPolicyBoundarySurvivesPreparationFailureForImmediateColdStart() async throws {
        let device = FakeCaptureDevice()
        device.preparationError = NSError(domain: "prepare-test", code: 1)
        let owner = AudioCaptureOwner(makeDevice: { device })
        let boundary: Int64 = 920_000
        await owner.setPreparationEnabled(true, revision: 1, afterPolicyChangeAt: boundary)
        let token = UUID()
        let started = try await owner.start(token: token, sessionID: boundary)
        XCTAssertEqual(started.sessionID, boundary + 1)
        let files = await owner.stop(token: token)
        await owner.setPreparationEnabled(false, revision: 2)
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
        let started = try await owner.start(token: token, sessionID: 910_005)
        XCTAssertEqual(started.sessionID, 910_005)
        let files = await owner.stop(token: token)
        await owner.setPreparationEnabled(false, revision: 2)
        for file in files { try? FileManager.default.removeItem(at: file) }
    }

    func testRouteInvalidationCannotReuseStaleSession() async throws {
        let device = FakeCaptureDevice()
        let owner = AudioCaptureOwner(makeDevice: { device })
        await owner.setPreparationEnabled(true, revision: 1)
        let token = UUID()
        _ = try await owner.start(token: token, sessionID: 910_006)
        var files = await owner.stop(token: token)
        await owner.setPreparationEnabled(true, revision: 2)
        await owner.invalidatePreparation()
        let next = UUID()
        _ = try await owner.start(token: next, sessionID: 910_007)
        files += await owner.stop(token: next)
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
            try await owner.start(token: token, sessionID: 910_010)
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
            try await owner.start(token: token, sessionID: 900_001)
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
            _ = try await owner.start(token: token, sessionID: 900_002)
            XCTFail("An invalidated attempt started")
        } catch is CancellationError { }
        XCTAssertEqual(device.configureCalls, 0)
    }

    func testStopSealsFilesBeforeReturningAndStaleStopCannotStopNextCapture() async throws {
        let device = FakeCaptureDevice()
        let owner = AudioCaptureOwner(makeDevice: { device })
        let first = UUID()
        _ = try await owner.start(token: first, sessionID: 900_003)
        let files = await owner.stop(token: first)
        defer { for file in files { try? FileManager.default.removeItem(at: file) } }
        XCTAssertEqual(files.count, 1)
        XCTAssertEqual(try String(contentsOf: XCTUnwrap(files.first), encoding: .utf8), "sealed")
        let second = UUID()
        _ = try await owner.start(token: second, sessionID: 900_004)
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
        _ = try await owner.start(token: token, sessionID: 900_005)
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
        _ = try await owner.start(token: token, sessionID: 900_006)
        XCTAssertEqual(device.startCalls, 2)
        let files = await owner.stop(token: token)
        for file in files { try? FileManager.default.removeItem(at: file) }
    }

    func testNontransientErrorIsNotRetried() async throws {
        let device = FakeCaptureDevice()
        device.startError = NSError(domain: "capture-test", code: 42)
        let owner = AudioCaptureOwner(makeDevice: { device })
        do {
            _ = try await owner.start(token: UUID(), sessionID: 900_007)
            XCTFail("Expected nontransient error")
        } catch { XCTAssertEqual((error as NSError).code, 42) }
        XCTAssertEqual(device.startCalls, 1)
        XCTAssertEqual(device.deactivateCalls, 1, "Failed capture must release audio")
    }

    func testTransientActivationFailureRetriesBeforeCapturing() async throws {
        let device = FakeCaptureDevice()
        device.configureErrors = [NSError(domain: NSOSStatusErrorDomain,
            code: AVAudioSession.ErrorCode.insufficientPriority.rawValue)]
        let owner = AudioCaptureOwner(makeDevice: { device })
        let token = UUID()
        _ = try await owner.start(token: token, sessionID: 900_011, mixWithOtherAudio: true)
        XCTAssertEqual(device.mixPolicies, [true, true])
        let sample = await owner.sample(token: token)
        XCTAssertEqual(sample?.isRecording, true)
        let files = await owner.stop(token: token)
        defer { for file in files { try? FileManager.default.removeItem(at: file) } }
        XCTAssertEqual(files.count, 1)
    }

    func testPersistentActivationFailureIsBoundedAndRelinquishesSession() async throws {
        let device = FakeCaptureDevice()
        device.configureError = NSError(domain: NSOSStatusErrorDomain,
            code: AVAudioSession.ErrorCode.insufficientPriority.rawValue)
        let owner = AudioCaptureOwner(makeDevice: { device })
        do {
            _ = try await owner.start(token: UUID(), sessionID: 900_012, mixWithOtherAudio: true)
            XCTFail("Expected activation failure")
        } catch {
            XCTAssertEqual((error as NSError).code, AVAudioSession.ErrorCode.insufficientPriority.rawValue)
        }
        XCTAssertEqual(device.configureCalls, 4, "Activation retries must use the existing bounded budget")
        XCTAssertEqual(device.startCalls, 0)
        XCTAssertGreaterThan(device.deactivateCalls, 0)
    }

    func testActivationFailureReleasesSessionAndAllowsRetry() async throws {
        let device = FakeCaptureDevice()
        let failure = NSError(domain: NSOSStatusErrorDomain, code: 560557684)
        device.configureError = failure
        let owner = AudioCaptureOwner(makeDevice: { device })
        await owner.setPreparationEnabled(true, revision: 1)
        do {
            _ = try await owner.start(token: UUID(), sessionID: 900_009)
            XCTFail("Expected activation failure")
        } catch {
            XCTAssertEqual((error as NSError).domain, failure.domain)
            XCTAssertEqual((error as NSError).code, failure.code)
        }
        XCTAssertEqual(device.deactivateCalls, 1)
        XCTAssertEqual(device.startCalls, 0)
        device.configureError = nil
        let retry = UUID()
        _ = try await owner.start(token: retry, sessionID: 900_010)
        let sample = await owner.sample(token: retry)
        XCTAssertEqual(sample?.isRecording, true)
        let files = await owner.stop(token: retry)
        defer { for file in files { try? FileManager.default.removeItem(at: file) } }
        XCTAssertEqual(files.count, 1)
    }

    func testFailedInterruptionResumeReleasesAudioAndPreservesSealedSegment() async throws {
        let device = FakeCaptureDevice()
        let owner = AudioCaptureOwner(makeDevice: { device })
        let token = UUID()
        _ = try await owner.start(token: token, sessionID: 900_008)
        await owner.interruptionBegan(token: token)
        device.startError = NSError(domain: "capture-test", code: 43)
        do {
            _ = try await owner.interruptionEnded(token: token, shouldResume: true)
            XCTFail("Expected resume failure")
        } catch { XCTAssertEqual((error as NSError).code, 43) }
        XCTAssertEqual(device.deactivateCalls, 1, "A failed resume must release audio immediately")
        let files = await owner.stop(token: token)
        defer { for file in files { try? FileManager.default.removeItem(at: file) } }
        XCTAssertEqual(files.count, 1)
        XCTAssertEqual(try String(contentsOf: XCTUnwrap(files.first), encoding: .utf8), "sealed")
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
