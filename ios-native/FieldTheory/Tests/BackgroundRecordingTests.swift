import XCTest
@testable import FieldTheory

@MainActor
final class BackgroundRecordingTests: XCTestCase {
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
