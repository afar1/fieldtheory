import XCTest
@testable import FieldTheory

final class ChatGPTRemoteLinkTests: XCTestCase {
    func testShortcutNameCannotInjectInputOrClipboardParameters() throws {
        let name = "Remote & input=clipboard?# 📱"
        let url = try XCTUnwrap(ChatGPTRemoteLink.shortcutURL(name: name))
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.scheme, "shortcuts")
        XCTAssertEqual(components.host, "run-shortcut")
        XCTAssertEqual(components.queryItems, [URLQueryItem(name: "name", value: name)])
        XCTAssertNil(components.fragment)
    }

    func testBlankNameDoesNotLaunchShortcut() {
        XCTAssertNil(ChatGPTRemoteLink.shortcutURL(name: " \n "))
        XCTAssertEqual(ChatGPTRemoteLink.shortcutURL(name: " Open Codex ")?.absoluteString,
                       "shortcuts://run-shortcut?name=Open%20Codex")
    }
}
