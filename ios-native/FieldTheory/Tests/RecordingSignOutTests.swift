import XCTest
@testable import FieldTheory

@MainActor
final class RecordingSignOutTests: XCTestCase {
    private var directory: URL!
    private var defaults: UserDefaults!
    private var suite: String!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        suite = "RecordingSignOutTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)!
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: directory)
        defaults.removePersistentDomain(forName: suite)
    }

    private func queue(_ name: String = "rec-100-0.wav") throws {
        try Data("recording".utf8).write(to: directory.appendingPathComponent(name))
    }

    func testSignOutDeletesQueuedAudioAndModelReadyCannotResumeIt() async throws {
        try queue()
        var calls = 0
        let recorder = RecorderController(pendingDirectory: directory, defaults: defaults,
                                         transcribe: { _ in calls += 1; return "private" })
        recorder.onTranscript = { _ in
            XCTFail("Signed-out audio was delivered")
            return false
        }
        recorder.setWorkEnabled(true)
        XCTAssertEqual(recorder.pendingSessionCount, 1)

        try await recorder.discardRecordings()
        await recorder.resumePendingWork()
        XCTAssertEqual(calls, 0)
        XCTAssertEqual(recorder.pendingSessionCount, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
    }

    func testLateTranscriptionCannotDeliverAfterSignOutAndAnotherSignIn() async throws {
        try queue()
        let started = expectation(description: "inference started")
        var finish: CheckedContinuation<String, Never>?
        var delivered: [String] = []
        let recorder = RecorderController(pendingDirectory: directory, defaults: defaults,
                                         transcribe: { _ in
            await withCheckedContinuation { continuation in
                finish = continuation
                started.fulfill()
            }
        })
        recorder.onTranscript = {
            delivered.append($0)
            return true
        }
        recorder.setWorkEnabled(true)
        let drain = Task { await recorder.drainPendingQueue() }
        await fulfillment(of: [started], timeout: 2)

        try await recorder.discardRecordings()
        recorder.setWorkEnabled(true)
        finish?.resume(returning: "previous account's recording")
        await drain.value
        XCTAssertTrue(delivered.isEmpty)
        XCTAssertEqual(recorder.phase, .idle)
        XCTAssertEqual(recorder.pendingSessionCount, 0)
    }

    func testSignOutWaitsForAlreadyStartedDeliveryBeforeStoreWipe() async throws {
        try queue()
        let started = expectation(description: "delivery started")
        var finish: CheckedContinuation<Void, Never>?
        var events: [String] = []
        let recorder = RecorderController(pendingDirectory: directory, defaults: defaults,
                                         transcribe: { _ in "text" })
        recorder.onTranscript = { _ in
            await withCheckedContinuation { continuation in
                finish = continuation
                started.fulfill()
            }
            events.append("delivery finished")
            return true
        }
        recorder.setWorkEnabled(true)
        let drain = Task { await recorder.drainPendingQueue() }
        await fulfillment(of: [started], timeout: 2)
        let discard = Task {
            try await recorder.discardRecordings()
            events.append("safe to wipe")
        }
        await Task.yield()
        finish?.resume()
        try await discard.value
        await drain.value
        XCTAssertEqual(events, ["delivery finished", "safe to wipe"])
    }

    func testInterruptedSignOutCleansAudioBeforeEnablingNextAccount() async throws {
        try queue()
        defaults.set(true, forKey: "voice-recording-cleanup-required")
        let recorder = RecorderController(pendingDirectory: directory, defaults: defaults)
        recorder.setWorkEnabled(true)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
        XCTAssertFalse(defaults.bool(forKey: "voice-recording-cleanup-required"))
    }

    func testSuspendSettlesStartedDeliveryWithoutRedeliveringAcrossWorkspaceSwap() async throws {
        try queue()
        let started = expectation(description: "delivery started")
        var finish: CheckedContinuation<Void, Never>?
        var delivered: [String] = []
        let recorder = RecorderController(
            pendingDirectory: directory,
            defaults: defaults,
            transcribe: { _ in "private account a" }
        )
        recorder.onTranscript = { text in
            started.fulfill()
            await withCheckedContinuation { finish = $0 }
            delivered.append(text)
            return true
        }
        recorder.setWorkEnabled(true)
        let drain = Task { await recorder.drainPendingQueue() }
        await fulfillment(of: [started], timeout: 2)

        let suspend = Task { await recorder.suspendAndWait() }
        await Task.yield()
        finish?.resume()
        await suspend.value
        await drain.value

        XCTAssertEqual(delivered, ["private account a"])
        XCTAssertEqual(recorder.pendingSessionCount, 0)
        recorder.setWorkEnabled(true)
        await recorder.resumePendingWork()
        XCTAssertEqual(delivered, ["private account a"])
    }

    func testFailedTranscriptPersistenceKeepsRawAudioForRetry() async throws {
        try queue()
        var attempts = 0
        let recorder = RecorderController(
            pendingDirectory: directory,
            defaults: defaults,
            transcribe: { _ in "recover me" }
        )
        recorder.onTranscript = { _ in
            attempts += 1
            return attempts > 1
        }
        recorder.setWorkEnabled(true)

        await recorder.drainPendingQueue()
        XCTAssertEqual(attempts, 1)
        XCTAssertEqual(recorder.pendingSessionCount, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.appendingPathComponent("rec-100-0.wav").path))

        await recorder.resumePendingWork()
        XCTAssertEqual(attempts, 2)
        XCTAssertEqual(recorder.pendingSessionCount, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("rec-100-0.wav").path))
    }
}
