import XCTest

/// Regression harness for the reader livelock: scrolling triggers chrome
/// (nav bar + tab bar) transitions, which change insets, which feed back
/// into the scroll handler. The app must stay responsive through sustained
/// scrolling in both directions, including direction flips near the top.
final class ReaderScrollUITests: XCTestCase {
    func testReaderSurvivesScrollingWithChromeTransitions() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview", "ft-open-doc"]
        app.launch()

        let surface = app.textViews.firstMatch
        XCTAssertTrue(surface.waitForExistence(timeout: 15), "document surface did not appear")

        // Deep scroll down through the 250-section fixture.
        for _ in 0..<12 { app.swipeUp(velocity: .fast) }
        // Back up.
        for _ in 0..<5 { app.swipeDown(velocity: .fast) }
        // Rapid direction flips around chrome-transition boundaries.
        for _ in 0..<6 {
            app.swipeUp(velocity: .slow)
            app.swipeDown(velocity: .slow)
        }

        // Typing must stay responsive on a huge document (styling is
        // attribute-only and line-scoped).
        surface.tap()
        surface.typeText("Live editing check, one two three. ")

        XCTAssertTrue(surface.exists, "document surface gone after interaction")
        XCTAssertTrue(app.tabBars.firstMatch.exists || app.buttons.firstMatch.exists,
                      "app chrome unreachable — likely hung")
    }
}
