import XCTest
@testable import FieldTheory

@MainActor
private final class TestVoiceProcessingTask: VoiceProcessingTask {
    let progress = Progress(totalUnitCount: 0)
    var expiration: (@Sendable () -> Void)?
    var results: [Bool] = []
    func onExpiration(_ handler: @escaping @Sendable () -> Void) { expiration = handler }
    func complete(success: Bool) { results.append(success) }
}

@MainActor
private final class TestVoiceProcessingScheduler: VoiceProcessingScheduler {
    var handler: (@MainActor (any VoiceProcessingTask) -> Void)?
    var submissions = 0
    var reject = false
    func register(_ handler: @escaping @MainActor (any VoiceProcessingTask) -> Void) -> Bool {
        self.handler = handler
        return true
    }
    func submit() throws {
        submissions += 1
        if reject { throw NSError(domain: "scheduler-unavailable", code: 1) }
    }
}

@MainActor
private final class ColdVoiceEngine: SpeechTranscriptionEngine {
    let runtimeIdentity = "test.cold"
    var state: SpeechEngineState = .preparing
    var onStateChange: (() -> Void)?
    var waiters: [CheckedContinuation<Void, Error>] = []
    var cancellations = 0
    func ensureDownloaded() {}
    func prepare() async throws {
        try await withCheckedThrowingContinuation { waiters.append($0) }
    }
    func cancelPreparation() {
        cancellations += 1
        state = .failed("cancelled")
        let current = waiters
        waiters.removeAll()
        current.forEach { $0.resume(throwing: CancellationError()) }
    }
    func transcribe(audioURL: URL) async throws -> String { XCTFail("Cold engine must not infer"); return "" }
}

final class VoiceContinuedProcessingTests: XCTestCase {
    @MainActor
    private func eventually(_ condition: () -> Bool) async -> Bool {
        for _ in 0..<200 {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return condition()
    }

    @MainActor
    func testSchedulerOwnsExecutionAndFinishesOnce() async {
        let scheduler = TestVoiceProcessingScheduler()
        let runner = VoiceContinuedProcessing(scheduler: scheduler, isForeground: { true })
        var calls = 0
        let run = Task { await runner.run { progress, continued in
            XCTAssertTrue(continued)
            calls += 1
            progress.completedUnitCount = 500
            return true
        } }
        let submitted = await eventually { scheduler.submissions == 1 }
        XCTAssertTrue(submitted)
        XCTAssertEqual(calls, 0)
        // Re-entrant Stop/Retry must not duplicate a submitted task.
        await runner.run { _, _ in calls += 1; return true }
        let systemTask = TestVoiceProcessingTask()
        scheduler.handler?(systemTask)
        await run.value
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(systemTask.results, [true])
        XCTAssertEqual(systemTask.progress.fractionCompleted, 1)
    }

    @MainActor
    func testSubmissionRefusalStillTranscribesInForeground() async {
        let scheduler = TestVoiceProcessingScheduler()
        scheduler.reject = true
        let runner = VoiceContinuedProcessing(scheduler: scheduler, isForeground: { true })
        var calls = 0
        await runner.run { _, _ in calls += 1; return true }
        await runner.run { _, _ in calls += 1; return true }
        XCTAssertEqual(calls, 2)
        XCTAssertEqual(scheduler.submissions, 2)
    }

    @MainActor
    func testBackgroundEntryDoesNotSubmitUserVisibleTask() async {
        let scheduler = TestVoiceProcessingScheduler()
        let runner = VoiceContinuedProcessing(scheduler: scheduler, isForeground: { false })
        var calls = 0
        await runner.run { _, _ in calls += 1; return true }
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(scheduler.submissions, 0)
    }

    @MainActor
    func testExpirationReleasesColdPreparationWaiter() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let audio = directory.appendingPathComponent("rec-456-0.wav")
        try Data("fixture".utf8).write(to: audio)
        let scheduler = TestVoiceProcessingScheduler()
        let runner = VoiceContinuedProcessing(scheduler: scheduler, isForeground: { true })
        let engine = ColdVoiceEngine()
        let recorder = RecorderController(pendingDirectory: directory, speechEngine: engine, continuedProcessing: runner)
        recorder.onTranscript = { _ in XCTFail("Cancelled preparation must not deliver"); return false }
        recorder.setWorkEnabled(true)
        let run = Task { await recorder.transcribeUserInitiated() }
        let submitted = await eventually { scheduler.submissions == 1 }
        XCTAssertTrue(submitted)
        let systemTask = TestVoiceProcessingTask()
        scheduler.handler?(systemTask)
        let preparing = await eventually { engine.waiters.count == 2 }
        XCTAssertTrue(preparing)
        systemTask.expiration?()
        let completed = await eventually { !systemTask.results.isEmpty }
        XCTAssertTrue(completed)
        await run.value
        XCTAssertEqual(systemTask.results, [false])
        XCTAssertEqual(engine.cancellations, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: audio.path))
    }

    @MainActor
    func testExpirationCancelsInferenceAndKeepsAudioForExistingRetry() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let audio = directory.appendingPathComponent("rec-123-0.wav")
        try Data("fixture".utf8).write(to: audio)
        let scheduler = TestVoiceProcessingScheduler()
        let runner = VoiceContinuedProcessing(scheduler: scheduler, isForeground: { true })
        var inferenceCalls = 0
        var deliveries = 0
        let recorder = RecorderController(pendingDirectory: directory,
            metricsDirectory: directory.appendingPathComponent("metrics"),
            transcribe: { _ in
                inferenceCalls += 1
                if inferenceCalls == 1 { try await Task.sleep(for: .seconds(30)) }
                return "fixture transcript"
            }, continuedProcessing: runner)
        recorder.onTranscript = { _ in deliveries += 1; return true }
        recorder.setWorkEnabled(true)
        let run = Task { await recorder.transcribeUserInitiated() }
        let submitted = await eventually { scheduler.submissions == 1 }
        XCTAssertTrue(submitted)
        await recorder.resumePendingWork()
        XCTAssertEqual(inferenceCalls, 0, "Foreground recovery must not race the scheduler's launch")
        let systemTask = TestVoiceProcessingTask()
        scheduler.handler?(systemTask)
        let started = await eventually { inferenceCalls == 1 }
        XCTAssertTrue(started)
        systemTask.expiration?()
        await run.value
        XCTAssertEqual(systemTask.results, [false])
        XCTAssertEqual(deliveries, 0)
        XCTAssertTrue(FileManager.default.fileExists(atPath: audio.path))
        XCTAssertEqual(recorder.phase, .idle)
        await recorder.resumePendingWork()
        XCTAssertEqual(inferenceCalls, 2)
        XCTAssertEqual(deliveries, 1)
        XCTAssertEqual(recorder.pendingSessionCount, 0)
        XCTAssertEqual(scheduler.submissions, 1, "Automatic recovery must not submit another user task")
    }
}
