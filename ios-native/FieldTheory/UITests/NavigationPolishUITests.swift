import XCTest

final class NavigationPolishUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLaunchesWithVoiceLibraryRiverTabs() {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = ["ft-preview"]
        app.launch()

        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.waitForExistence(timeout: 10), "tab bar did not appear")

        let labels = tabBar.buttons.allElementsBoundByIndex
            .sorted { $0.frame.minX < $1.frame.minX }
            .map { $0.label }
        XCTAssertEqual(Array(labels.prefix(3)), ["Voice", "Library", "River"])
        XCTAssertTrue(tabBar.buttons["Voice"].isSelected, "Voice should be the default mobile tab")
    }

    func testDocumentDisplayControlsStayOpenAcrossChanges() {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = ["ft-preview", "ft-open-doc"]
        app.launch()

        XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 15), "document surface did not appear")
        app.navigationBars.buttons["More"].tap()
        app.buttons["Display"].tap()

        let display = app.navigationBars["Display"]
        XCTAssertTrue(display.waitForExistence(timeout: 5), "display controls did not open")

        let lineNumbers = app.switches["Line numbers"]
        XCTAssertTrue(lineNumbers.waitForExistence(timeout: 5), "line-number toggle missing")
        lineNumbers.tap()
        XCTAssertTrue(display.exists, "display controls dismissed after toggling line numbers")

        app.buttons.matching(labelStartingWith("Text size")).firstMatch.tap()
        app.buttons["Large"].tap()
        XCTAssertTrue(display.exists, "display controls dismissed after changing text size")

        app.buttons.matching(labelStartingWith("Line spacing")).firstMatch.tap()
        app.buttons["Loose"].tap()
        XCTAssertTrue(display.exists, "display controls dismissed after changing line spacing")
    }

    private func labelStartingWith(_ text: String) -> NSPredicate {
        NSPredicate(format: "label BEGINSWITH %@", text)
    }
}
