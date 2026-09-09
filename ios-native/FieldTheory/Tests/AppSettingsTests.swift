import XCTest
@testable import FieldTheory

@MainActor
final class AppSettingsTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "AppSettingsTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func testLegacyEnginePreferenceIsRemovedWithoutChangingOtherSettings() {
        defaults.set("whisper", forKey: "ft.speechEngineChoice.v1")
        defaults.set("unrelated", forKey: "preserve-setting")

        _ = AppSettings(defaults: defaults)

        XCTAssertNil(defaults.object(forKey: "ft.speechEngineChoice.v1"))
        XCTAssertEqual(defaults.string(forKey: "preserve-setting"), "unrelated")
    }
}
