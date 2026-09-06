import UIKit
import XCTest

final class iPadAdaptiveLayoutUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        guard UIDevice.current.userInterfaceIdiom == .pad else {
            throw XCTSkip("iPad layout coverage")
        }
    }

    func testTopLevelNavigationSurvivesRotation() {
        XCUIDevice.shared.orientation = .landscapeLeft

        let app = XCUIApplication()
        app.launchArguments = ["ft-preview"]
        app.launch()

        for tab in ["Voice", "Library", "River", "Goals"] {
            let button = app.buttons[tab].firstMatch
            XCTAssertTrue(button.waitForExistence(timeout: 10), "\(tab) navigation item is missing")
            button.tap()
        }

        attachScreenshot(named: "Field Theory iPad Landscape", app: app)

        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.buttons["Goals"].firstMatch.waitForExistence(timeout: 5))
        attachScreenshot(named: "Field Theory iPad Portrait", app: app)
    }

    func testLibraryOpensDocumentWithoutReplacingNavigationShell() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-open-doc"]
        app.launch()

        XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 15), "document editor did not appear")
        XCTAssertTrue(app.otherElements["FieldTheoryTabView"].exists || app.buttons["Library"].firstMatch.exists,
                      "top-level iPad navigation disappeared while reading")
        attachScreenshot(named: "Field Theory iPad Document", app: app)
    }

    private func attachScreenshot(named name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
