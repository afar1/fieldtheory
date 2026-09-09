import XCTest

#if targetEnvironment(simulator)
final class ChatGPTRemoteUITests: XCTestCase {
    func testRemoteSetupPreservesCountdown() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-privacy-preview",
                               "-chatgpt-remote-shortcut-configured", "NO"]
        app.launch()
        XCTAssertTrue(app.buttons["VoiceRecordingControl"].firstMatch.waitForExistence(timeout: 15))
        let remote = app.buttons.matching(NSPredicate(format: "label == %@", "Open Remote")).firstMatch
        XCTAssertTrue(remote.waitForExistence(timeout: 5))
        remote.tap()
        XCTAssertTrue(app.navigationBars["ChatGPT Remote"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["RemoteShortcutName"].exists)
        XCTAssertTrue(app.buttons["I’ve added this shortcut"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "chatgpt-remote-setup"
        attachment.lifetime = .keepAlways
        add(attachment)
        app.navigationBars["ChatGPT Remote"].buttons["Done"].tap()
        let pending = app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier == %@ AND value == %@",
            "VoiceTranscript-t-1", "send")).firstMatch
        XCTAssertTrue(pending.waitForExistence(timeout: 10))
        XCTAssertEqual(pending.value as? String, "send")
    }
}
#endif
