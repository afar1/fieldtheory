import XCTest

final class SubmissionReadinessUITests: XCTestCase {
    func testVoiceStackAndUnstackPreservesBothTranscripts() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview"]
        app.launch()

        let first = app.descendants(matching: .any)["VoiceTranscript-t-1"].firstMatch
        let second = app.descendants(matching: .any)["VoiceTranscript-t-2"].firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 15))
        if app.buttons["Select"].firstMatch.isHittable {
            app.buttons["Select"].firstMatch.tap()
            first.tap()
        } else {
            first.press(forDuration: 0.8)
        }
        second.tap()
        let stack = app.buttons["Stack"].firstMatch
        XCTAssertTrue(stack.waitForExistence(timeout: 5))
        stack.tap()
        XCTAssertTrue(app.staticTexts["Stacked"].waitForExistence(timeout: 5))
        XCTAssertFalse(second.exists)

        if app.buttons["Select"].firstMatch.isHittable {
            app.buttons["Select"].firstMatch.tap()
            first.tap()
        } else {
            first.press(forDuration: 0.8)
        }
        let unstack = app.buttons["Unstack"].firstMatch
        XCTAssertTrue(unstack.waitForExistence(timeout: 5))
        unstack.tap()
        XCTAssertTrue(second.waitForExistence(timeout: 5))
        XCTAssertTrue(first.exists)
    }

    func testSignedOutReviewerDemoRoundTripShowsVoiceOnlyWorkspace() {
        let app = XCUIApplication()
        app.launch()

        let openDemo = app.buttons["ReviewerDemoButton"]
        XCTAssertTrue(openDemo.waitForExistence(timeout: 10))
        openDemo.tap()

        XCTAssertTrue(app.navigationBars["Voice"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["Library"].exists)
        XCTAssertFalse(app.buttons["River"].exists)
        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.tap()

        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
        let exitDemo = app.buttons["Exit Reviewer Demo"]
        for _ in 0..<6 where !exitDemo.exists { app.swipeUp() }
        XCTAssertTrue(app.staticTexts["Reviewer Demo"].firstMatch.exists)
        XCTAssertTrue(app.staticTexts["Local sample workspace"].exists)
        XCTAssertTrue(exitDemo.exists)
        exitDemo.tap()

        XCTAssertTrue(app.buttons["ReviewerDemoButton"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.navigationBars["Voice"].exists)
    }

    func testPrivacyLinksAndVoiceOnlySettingsAfterExitingReviewerDemo() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview"]
        app.launch()

        XCTAssertTrue(app.navigationBars["Voice"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Goals"].exists)
        XCTAssertFalse(app.buttons["Library"].exists)
        XCTAssertFalse(app.buttons["River"].exists)
        app.buttons["Settings"].tap()

        let policy = app.descendants(matching: .any)["PrivacyPolicyLink"].firstMatch
        for _ in 0..<5 where !policy.isHittable { app.swipeUp() }
        XCTAssertTrue(policy.exists)
        let support = app.descendants(matching: .any)["SupportLink"].firstMatch
        for _ in 0..<5 where !support.isHittable { app.swipeUp() }
        XCTAssertTrue(support.exists)

        let exitDemo = app.buttons["Exit Reviewer Demo"]
        XCTAssertTrue(exitDemo.exists)
        exitDemo.tap()
        XCTAssertTrue(app.buttons["Send Code"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["PrivacyPolicyLink"].firstMatch.exists)
    }
}
