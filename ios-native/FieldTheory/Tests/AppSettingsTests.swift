import XCTest
@testable import FieldTheory

@MainActor
final class AppSettingsTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "AppSettingsTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func testAutoSendOffDuringCaptureAndReenableExcludeOlderAudio() async throws {
        let settings = AppSettings(defaults: defaults)
        try await Task.sleep(nanoseconds: 3_000_000)
        let recording = String(Timestamps.nowMs())
        XCTAssertTrue(settings.shouldAutoSend(sessionID: recording))
        settings.autoSendTranscriptions = false
        XCTAssertFalse(settings.shouldAutoSend(sessionID: recording))
        try await Task.sleep(nanoseconds: 3_000_000)
        settings.autoSendTranscriptions = true
        XCTAssertFalse(settings.shouldAutoSend(sessionID: recording))
        XCTAssertTrue(settings.shouldAutoSend(sessionID: String(settings.autoSendEnabledSinceMs + 1)))
        let reopened = AppSettings(defaults: defaults)
        XCTAssertFalse(reopened.shouldAutoSend(sessionID: recording))
        XCTAssertFalse(reopened.shouldAutoSend(sessionID: "legacy-import"))
    }

    func testDiscardConfirmationDefaultsOnAndPersistsOptOut() {
        let settings = AppSettings(defaults: defaults)
        XCTAssertTrue(settings.confirmBeforeDiscarding)
        settings.confirmBeforeDiscarding = false
        XCTAssertFalse(AppSettings(defaults: defaults).confirmBeforeDiscarding)
        settings.confirmBeforeDiscarding = true
        XCTAssertTrue(AppSettings(defaults: defaults).confirmBeforeDiscarding)
    }

    func testRecordingOnOpenDefaultsOffAndPersistsOnlyExplicitOptIn() {
        let settings = AppSettings(defaults: defaults)
        XCTAssertFalse(settings.startRecordingOnOpen)
        settings.startRecordingOnOpen = true
        XCTAssertTrue(AppSettings(defaults: defaults).startRecordingOnOpen)
        settings.startRecordingOnOpen = false
        XCTAssertFalse(AppSettings(defaults: defaults).startRecordingOnOpen)
    }

    func testLegacyEnginePreferenceIsRemovedWithoutChangingOtherSettings() {
        defaults.set("whisper", forKey: "ft.speechEngineChoice.v1")
        defaults.set("unrelated", forKey: "preserve-setting")

        _ = AppSettings(defaults: defaults)

        XCTAssertNil(defaults.object(forKey: "ft.speechEngineChoice.v1"))
        XCTAssertEqual(defaults.string(forKey: "preserve-setting"), "unrelated")
    }
}
