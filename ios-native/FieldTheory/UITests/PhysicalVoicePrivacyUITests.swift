import XCTest

/// Reads the existing phone workspace without fixtures, account changes,
/// recording creation, or deletion. Run explicitly against Focus.
final class PhysicalVoicePrivacyUITests: XCTestCase {
    func testInstalledVoiceSurface() throws {
#if targetEnvironment(simulator)
        throw XCTSkip("This check is for the installed physical phone")
#else
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.navigationBars["Voice"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["Ready for on-device transcription."].exists)
        XCTAssertFalse(app.staticTexts["Using Parakeet"].exists)
        let status = app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier BEGINSWITH %@ AND (label == %@ OR label == %@)",
            "VoiceTranscript-", "Local", "Cloud synced"
        )).firstMatch
        XCTAssertTrue(status.waitForExistence(timeout: 10))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "focus-installed-voice-privacy"
        screenshot.lifetime = .keepAlways
        add(screenshot)
#endif
    }
}
