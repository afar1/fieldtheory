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

        let scroll = app.scrollViews.firstMatch
        XCTAssertTrue(scroll.waitForExistence(timeout: 15), "reader did not appear")

        // Deep scroll down through the 250-section fixture.
        for _ in 0..<12 { app.swipeUp(velocity: .fast) }
        // Back up — chrome returns.
        for _ in 0..<5 { app.swipeDown(velocity: .fast) }
        // Rapid direction flips around the hide/show boundary, where the
        // oscillation lived.
        for _ in 0..<6 {
            app.swipeUp(velocity: .slow)
            app.swipeDown(velocity: .slow)
        }

        // A hang would stall the swipes themselves; prove we can still
        // query and interact afterwards.
        XCTAssertTrue(scroll.exists, "reader scroll view gone after scrolling")
        XCTAssertTrue(app.tabBars.firstMatch.exists || app.buttons.firstMatch.exists,
                      "app chrome unreachable after scrolling — likely hung")
    }
}
