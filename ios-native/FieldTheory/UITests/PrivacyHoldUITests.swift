import XCTest

#if targetEnvironment(simulator)
final class PrivacyHoldUITests: XCTestCase {
    func testToggleReplacesCountdownAndSelectionMarkersRemainVisible() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-card-layout-preview"]
        app.launch()
        let toggle = app.buttons["AutoSendTranscriptions"].firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 15))
        let original = toggle.value as? String
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.94, dy: 0.5)).tap()
        XCTAssertNotEqual(toggle.value as? String, original)
        XCTAssertFalse(app.staticTexts["Send to agent in"].exists)
        let badge = app.buttons["Send to agent"].firstMatch
        XCTAssertTrue(badge.exists)
        let expand = app.buttons["Expand transcript"].firstMatch
        let body = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 100, dy: expand.frame.minY - 40))
        body.press(forDuration: 0.8)
        XCTAssertTrue(app.images["Deselect transcript"].firstMatch.waitForExistence(timeout: 3))
        XCTAssertTrue(app.images["Select transcript"].firstMatch.exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "auto-send-selection"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testCompactAutoSendAndBottomStackCount() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-card-layout-preview", "ft-stack-preview"]
        app.launch()
        let control = app.buttons["AutoSendTranscriptions"].firstMatch
        XCTAssertTrue(control.waitForExistence(timeout: 15))
        let cloud = app.buttons["Saved to cloud"].firstMatch
        XCTAssertLessThan(control.frame.maxY, cloud.frame.minY)
        XCTAssertGreaterThanOrEqual(control.frame.height, 44)
        let count = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Stack count")).firstMatch
        XCTAssertTrue(count.exists)
        XCTAssertGreaterThan(count.frame.minY, cloud.frame.maxY)
        let expand = app.buttons["Expand transcript"].firstMatch
        XCTAssertLessThan(count.frame.maxX, expand.frame.maxX)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "compact-auto-send-bottom-stack"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testCardLayoutAndExpansion() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-card-layout-preview"]
        app.launch()
        let expand = app.buttons["Expand transcript"].firstMatch
        XCTAssertTrue(expand.waitForExistence(timeout: 15))
        let cloud = app.buttons["Saved to cloud"].firstMatch
        let remote = app.buttons["Open Remote"].firstMatch
        XCTAssertTrue(cloud.exists)
        XCTAssertTrue(app.buttons["Send to agent"].firstMatch.exists)
        XCTAssertTrue(app.buttons["Sent to agent"].firstMatch.exists)
        XCTAssertGreaterThan(expand.frame.minY, cloud.frame.maxY)
        XCTAssertLessThan(cloud.frame.maxX, remote.frame.minX)
        let width = expand.frame.width
        XCTAssertGreaterThan(width, 55)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "card-layout-collapsed"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        expand.tap()
        let collapse = app.buttons["Collapse transcript"].firstMatch
        XCTAssertTrue(collapse.waitForExistence(timeout: 3))
        XCTAssertEqual(collapse.frame.width, width, accuracy: 1)
        collapse.tap()
        XCTAssertTrue(expand.waitForExistence(timeout: 3))
    }

    func testAmbitionSwipeOffersExplicitSupportSubmission() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-card-layout-preview"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Field Theory"].waitForExistence(timeout: 15))
        let expand = app.buttons["Expand transcript"].firstMatch
        XCTAssertTrue(expand.waitForExistence(timeout: 5))
        let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: expand.frame.maxX - 20, dy: expand.frame.minY - 35))
        let end = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 60, dy: expand.frame.minY - 35))
        start.press(forDuration: 0.05, thenDragTo: end)
        let feedback = app.buttons["Send feedback to support"].firstMatch
        XCTAssertTrue(feedback.waitForExistence(timeout: 3))
        feedback.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "No audio is included")).firstMatch.waitForExistence(timeout: 3))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "ambition-feedback-confirmation"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    private func assertStatus(_ value: String, id: String, in app: XCUIApplication) {
        let badge = app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier == %@ AND value == %@", "VoiceTranscript-\(id)", value
        )).firstMatch
        XCTAssertTrue(badge.waitForExistence(timeout: 5))
    }

    func testUnsentBadgeOffersExplicitSendConfirmation() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-card-layout-preview"]
        app.launch()
        let badge = app.buttons["Send to agent"].firstMatch
        XCTAssertTrue(badge.waitForExistence(timeout: 15))
        badge.tap()
        XCTAssertTrue(app.staticTexts["Send this transcript to the agent?"].waitForExistence(timeout: 3))
    }
}
#endif
