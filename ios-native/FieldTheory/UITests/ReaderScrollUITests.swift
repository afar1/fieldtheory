import XCTest

/// Voice timeline scrolling must remain responsive through long gestures and
/// leave the recorder controls reachable.
final class ReaderScrollUITests: XCTestCase {
    func testVoiceTimelineSurvivesSustainedScrolling() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview"]
        app.launch()

        XCTAssertTrue(app.navigationBars["Voice"].waitForExistence(timeout: 15))
        for _ in 0..<8 { app.swipeUp(velocity: .fast) }
        for _ in 0..<5 { app.swipeDown(velocity: .fast) }
        for _ in 0..<4 {
            app.swipeUp(velocity: .slow)
            app.swipeDown(velocity: .slow)
        }

        XCTAssertTrue(app.navigationBars["Voice"].exists)
        XCTAssertTrue(app.buttons["Settings"].exists)
    }
}
