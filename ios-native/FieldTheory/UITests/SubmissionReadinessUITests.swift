import XCTest

final class SubmissionReadinessUITests: XCTestCase {
    func testPrivacyLinksAndThreeTabAppAfterSignOut() {
        let app = XCUIApplication()
        app.launchArguments = ["ft-preview"]
        app.launch()

        XCTAssertTrue(app.buttons["Library"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Goals"].exists)
        app.buttons["Library"].firstMatch.tap()
        app.buttons["Settings"].firstMatch.tap()

        let policy = app.descendants(matching: .any)["PrivacyPolicyLink"].firstMatch
        for _ in 0..<5 where !policy.isHittable { app.swipeUp() }
        XCTAssertTrue(policy.exists)
        XCTAssertTrue(app.descendants(matching: .any)["SupportLink"].firstMatch.exists)

        let signOut = app.buttons["Sign out"]
        XCTAssertTrue(signOut.exists)
        signOut.tap()
        XCTAssertTrue(app.buttons["Send Code"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["PrivacyPolicyLink"].firstMatch.exists)
        XCTAssertFalse(app.buttons["Goals"].exists)
    }
}
