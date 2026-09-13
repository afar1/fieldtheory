import XCTest

final class VoiceDeliveryUITests: XCTestCase {
    func testDeliveryTimelineShowsConfirmedStages() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-delivery-preview"]
        app.launch()
        let status = app.buttons["Complete"].firstMatch
        XCTAssertTrue(status.waitForExistence(timeout: 15))
        status.tap()
        XCTAssertTrue(app.navigationBars["Delivery timeline"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Queued in Codex"].exists)
        XCTAssertTrue(app.staticTexts["Working"].exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Voice delivery timeline"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
