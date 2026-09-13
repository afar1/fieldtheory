import XCTest
@testable import FieldTheory

@MainActor
final class BackgroundRecordingTests: XCTestCase {
    func testLegacyCopyMigratesToStopAndSurvivesFailedDeliveryUntilRetry() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let suite = "StopChoiceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(["100": "copy"], forKey: "ft-recording-finish-actions")
        try Data("audio fixture".utf8).write(to: root.appendingPathComponent("rec-100-0.wav"))
        let recorder = RecorderController(pendingDirectory: root, defaults: defaults, transcribe: { _ in "test transcript" })
        var accept = false
        recorder.onTranscript = { _ in
            XCTAssertEqual(recorder.finishAction(for: recorder.currentDeliverySessionID), .stop)
            return accept
        }
        recorder.setWorkEnabled(true)
        await recorder.drainPendingQueue()
        XCTAssertEqual(recorder.pendingSessionCount, 1)
        XCTAssertEqual(recorder.finishAction(for: "100"), .stop)
        recorder.setFinishAction(.send, expectedID: "100")
        XCTAssertEqual(recorder.finishAction(for: "100"), .stop, "An idle/stale action cannot change a queued recording's choice")
        accept = true
        await recorder.drainPendingQueue()
        XCTAssertEqual(recorder.pendingSessionCount, 0)
        XCTAssertNil(recorder.finishAction(for: "100"))
    }

    func testIntentStartRejectsDisabledRecorderWithoutActivatingMicrophone() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let recorder = RecorderController(pendingDirectory: root, transcribe: { _ in "test" })
        XCTAssertThrowsError(try recorder.startFromIntent())
        XCTAssertEqual(recorder.phase, .idle)
        XCTAssertNil(recorder.startedAt)
    }

    func testTranscriptPersistenceWorksWithoutCreatingRootViewAndSurvivesRecorderSwap() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let suite = "BackgroundRecordingTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let recorder = RecorderController(pendingDirectory: root.appendingPathComponent("audio"),
            defaults: defaults, transcribe: { _ in "test" })
        let model = AppModel(databasePathOverride: root.appendingPathComponent("db.sqlite").path,
            libraryRootOverride: root.appendingPathComponent("library"),
            reviewerDemoDatabasePathOverride: root.appendingPathComponent("demo.sqlite").path,
            reviewerDemoRootOverride: root.appendingPathComponent("demo"),
            recorderOverride: recorder, startInitialPreparation: false)
        model.auth.onPhaseChange = nil
        XCTAssertNotNil(recorder.onTranscript, "Cold launch must wire persistence before a scene appears")
        try await model.enterReviewerDemo { _, _, _, _ in }
        XCTAssertFalse(model.recorder === recorder)
        let save = try XCTUnwrap(model.recorder.onTranscript)
        let saved = await save("spoken without opening a screen")
        XCTAssertTrue(saved)
        XCTAssertEqual(model.transcripts.items.map(\.text), ["spoken without opening a screen"])
        let staleSave = try XCTUnwrap(recorder.onTranscript)
        let staleAccepted = await staleSave("old workspace")
        XCTAssertFalse(staleAccepted)
    }
}
