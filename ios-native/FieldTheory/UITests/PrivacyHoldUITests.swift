import XCTest

#if targetEnvironment(simulator)
final class PrivacyHoldUITests: XCTestCase {
    func testSavedAudioKeepsRecordPrimaryAndOffersRetry() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-recording-controls-preview", "ft-recording-state", "pending"]
        app.launch()
        let record = app.buttons["VoiceRecordingControl"].firstMatch
        XCTAssertTrue(record.waitForExistence(timeout: 15))
        XCTAssertEqual(record.label, "Record")
        XCTAssertTrue(app.buttons["VoiceRetryTranscription"].exists)
        XCTAssertTrue(app.buttons["VoiceDiscardAudio"].exists)
    }

    func testSavedAudioExplainsWhyTranscriptionPaused() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-recording-controls-preview", "ft-recording-state", "pendingLong"]
        app.launch()
        let details = app.buttons["VoicePendingAudioDetails"].firstMatch
        XCTAssertTrue(details.waitForExistence(timeout: 15))
        details.tap()
        XCTAssertTrue(app.alerts["Saved recording"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] %@", "audio is saved on this phone")).firstMatch.exists)
        app.alerts.buttons["OK"].tap()
        let card = app.descendants(matching: .any)["VoiceTranscribingCard-preview-pending"].firstMatch
        XCTAssertTrue(card.exists)
        card.tap()
        XCTAssertTrue(app.alerts["Saved recording"].waitForExistence(timeout: 5))
    }

    func testTranscriptionProgressUsesPendingCardWhileRecordStaysCompact() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-recording-controls-preview", "ft-recording-state", "transcribing"]
        app.launch()

        let record = app.buttons["VoiceRecordingControl"].firstMatch
        XCTAssertTrue(record.waitForExistence(timeout: 15))
        XCTAssertEqual(record.label, "Record")
        XCTAssertFalse(record.isEnabled)
        let pendingCard = app.descendants(matching: .any)["VoiceTranscribingCard-preview-0"].firstMatch
        XCTAssertTrue(pendingCard.waitForExistence(timeout: 5))
        XCTAssertEqual(pendingCard.label, "Transcribing")
        XCTAssertFalse(app.staticTexts["Converting audio to text…"].exists)
    }

    func testActiveRecordingCanBeKeptThenDiscarded() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-recording-controls-preview", "--recording-startup-diagnostics-once"]
        app.launch()
        let record = app.buttons["VoiceRecordingControl"].firstMatch
        XCTAssertTrue(record.waitForExistence(timeout: 15))
        let idle = app.buttons.matching(identifier: "VoiceRecordingControl")
            .matching(NSPredicate(format: "label == %@", "Record")).firstMatch
        XCTAssertTrue(idle.waitForExistence(timeout: 5), "Wait for model-ready confirmation to finish")
        let idleFrame = record.frame
        record.tap()
        XCTAssertFalse(app.staticTexts["Starting recording…"].exists)
        let cancel = app.buttons["VoiceCancelRecording"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        XCTAssertEqual(record.label, "Stop recording")
        XCTAssertTrue(record.isEnabled, "Stop must be available as soon as recording appears")
        XCTAssertEqual(record.frame.midX, idleFrame.midX, accuracy: 0.5, "The cancel control must not push the pill sideways")
        XCTAssertEqual(record.frame.midY, idleFrame.midY, accuracy: 0.5, "The pill stays on the same baseline")
        XCTAssertEqual(record.frame.width, idleFrame.width, accuracy: 0.5, "Record keeps its width when recording starts")
        XCTAssertLessThanOrEqual(record.frame.height, 56, "Recording stays in the compact Record pill")
        cancel.tap()
        let alert = app.alerts["Are you sure you want to discard this audio?"]
        XCTAssertTrue(alert.waitForExistence(timeout: 3))
        alert.buttons["Keep recording"].tap()
        XCTAssertTrue(cancel.exists)
        XCTAssertLessThan(cancel.frame.maxX, record.frame.minX)
        XCTAssertGreaterThanOrEqual(cancel.frame.width, 44 - 0.01, "Allow floating-point rounding of the 44-point target")
        XCTAssertLessThanOrEqual(record.frame.maxX, app.frame.maxX)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "red-stop-recording-control"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        cancel.tap()
        alert.buttons["Discard audio"].tap()
        XCTAssertTrue(app.buttons["VoiceRecordingControl"].waitForExistence(timeout: 3))
        XCTAssertFalse(cancel.exists)
        XCTAssertFalse(app.buttons["VoiceDiscardAudio"].exists)
    }

    func testCompletedRecordingReturnsToRecordWithoutSuccessBanner() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-recording-controls-preview", "--disable-recording-startup-diagnostics"]
        app.launch()
        let record = app.buttons["VoiceRecordingControl"].firstMatch
        XCTAssertTrue(record.waitForExistence(timeout: 15))
        record.tap()
        let stop = app.buttons.matching(identifier: "VoiceRecordingControl")
            .matching(NSPredicate(format: "label == %@", "Stop recording")).firstMatch
        XCTAssertTrue(stop.waitForExistence(timeout: 5))
        stop.tap()
        XCTAssertTrue(app.buttons["Preview transcript"].firstMatch.waitForExistence(timeout: 10))
        let ready = app.buttons.matching(identifier: "VoiceRecordingControl")
            .matching(NSPredicate(format: "label == %@", "Record")).firstMatch
        XCTAssertTrue(ready.waitForExistence(timeout: 5), "Completion must return to Record")
        XCTAssertFalse(app.staticTexts["Saved to Field Theory"].exists)
        XCTAssertFalse(app.buttons["VoiceCancelRecording"].exists)
        XCTAssertFalse(app.buttons["VoiceDiscardAudio"].exists)
    }

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
