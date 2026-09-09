import UIKit
import XCTest

final class iPadAdaptiveLayoutUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        guard UIDevice.current.userInterfaceIdiom == .pad else {
            throw XCTSkip("iPad layout coverage")
        }
    }

    func testVoiceWorkspaceSurvivesRotationWithoutSectionSidebar() {
        XCUIDevice.shared.orientation = .landscapeLeft

        let app = XCUIApplication()
        app.launchArguments = ["ft-preview"]
        app.launch()

        XCTAssertTrue(app.navigationBars["Voice"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Settings"].exists)
        XCTAssertFalse(app.buttons["Library"].exists)
        XCTAssertFalse(app.buttons["River"].exists)
        attachScreenshot(named: "Field Theory iPad Voice Landscape", app: app)

        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.navigationBars["Voice"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Settings"].exists)
        attachScreenshot(named: "Field Theory iPad Voice Portrait", app: app)
    }

    func testVoiceSettingsKeepsNavigationShellOnIPad() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview"]
        app.launch()

        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        XCTAssertTrue(app.navigationBars["Voice"].waitForExistence(timeout: 5))
    }

    private func attachScreenshot(named name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
