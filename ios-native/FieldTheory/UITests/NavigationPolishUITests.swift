import XCTest

final class NavigationPolishUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLaunchesDirectlyIntoVoiceWithoutLibraryOrRiverNavigation() {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = ["ft-preview"]
        app.launch()

        XCTAssertTrue(app.navigationBars["Voice"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Settings"].exists)
        XCTAssertFalse(app.tabBars.firstMatch.exists)
        XCTAssertFalse(app.buttons["Library"].exists)
        XCTAssertFalse(app.buttons["River"].exists)
        XCTAssertFalse(app.buttons["Goals"].exists)
    }

    func testVoiceSettingsStaysOpenAcrossAppearanceChanges() {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = ["ft-preview"]
        app.launch()

        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.tap()

        let settingsNavigation = app.navigationBars["Settings"]
        XCTAssertTrue(settingsNavigation.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Appearance"].exists)
        XCTAssertTrue(app.staticTexts["Voice"].exists)
        XCTAssertFalse(app.staticTexts["Library"].exists)
        app.buttons["Done"].tap()
        XCTAssertTrue(app.navigationBars["Voice"].waitForExistence(timeout: 5))
    }
}
