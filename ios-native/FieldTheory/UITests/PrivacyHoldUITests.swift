import XCTest

#if targetEnvironment(simulator)
final class PrivacyHoldUITests: XCTestCase {
    func testMainControlKeepsLocalThenPreservesBackgroundCountdown() throws {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-privacy-preview"]
        app.launch()
        let control = app.buttons["VoiceRecordingControl"].firstMatch
        XCTAssertTrue(control.waitForExistence(timeout: 15))
        XCTAssertTrue(control.label.contains("No action"))
        XCTAssertTrue(control.label.contains("Send to agent in"))
        XCTAssertEqual(control.value as? String, "t-1")
        XCTAssertFalse(app.buttons["KeepLocal-t-1"].exists)
        XCTAssertFalse(app.staticTexts["Keep recent recording local"].exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "main-control-keep-transcript-local"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        control.tap()

        let second = app.buttons.matching(NSPredicate(
            format: "identifier == %@ AND value == %@", "VoiceRecordingControl", "t-2"
        )).firstMatch
        XCTAssertTrue(second.waitForExistence(timeout: 3))
        XCTAssertTrue(second.label.contains("No action"))
        XCTAssertFalse(app.buttons["Record"].exists)
        XCUIDevice.shared.press(.home)
        let elapsed = expectation(description: "Countdown elapsed in background")
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { elapsed.fulfill() }
        wait(for: [elapsed], timeout: 10)
        app.activate()

        // Queued choices wait for display instead of silently expiring.
        let third = app.buttons.matching(NSPredicate(
            format: "identifier == %@ AND value == %@", "VoiceRecordingControl", "t-3"
        )).firstMatch
        XCTAssertTrue(third.waitForExistence(timeout: 3))
        third.tap()
        let record = app.buttons.matching(NSPredicate(
            format: "identifier == %@ AND label == %@", "VoiceRecordingControl", "Record"
        )).firstMatch
        XCTAssertTrue(record.waitForExistence(timeout: 3))
        assertStatus("no_action", id: "t-1", in: app)
        assertStatus("send", id: "t-2", in: app)
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
        XCTAssertTrue(app.buttons["Transcript"].firstMatch.exists)
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
        XCTAssertTrue(app.navigationBars["Ambition"].waitForExistence(timeout: 15))
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

    func testLocalBadgeOffersCancelAndExplicitCloudSync() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-privacy-preview"]
        app.launch()
        let control = app.buttons["VoiceRecordingControl"].firstMatch
        XCTAssertTrue(control.waitForExistence(timeout: 15))
        control.tap()
        let local = app.buttons.matching(NSPredicate(
            format: "label == %@ AND value == %@", "Transcript", "no_action"
        )).firstMatch
        XCTAssertTrue(local.waitForExistence(timeout: 3))
        local.tap()
        let sync = app.buttons["Send to agent"].firstMatch
        XCTAssertTrue(sync.waitForExistence(timeout: 3))
        // iOS may present this as a popover, where tapping outside is Cancel.
        let cancel = app.buttons["Cancel"].firstMatch
        if cancel.exists {
            cancel.tap()
        } else {
            let dismiss = app.otherElements["PopoverDismissRegion"].firstMatch
            XCTAssertTrue(dismiss.exists)
            dismiss.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.9)).tap()
        }
        XCTAssertTrue(local.exists)
        local.tap()
        XCTAssertTrue(sync.waitForExistence(timeout: 3))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "local-badge-cloud-sync-option"
        attachment.lifetime = .keepAlways
        add(attachment)
        sync.tap()
        assertStatus("send", id: "t-1", in: app)
        XCTAssertFalse(local.exists)
    }
}
#endif
