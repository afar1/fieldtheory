import CoreGraphics
import XCTest
@testable import NativeKeyboardEvents

final class CommandPasteShortcutTests: XCTestCase {
    private struct Event: Equatable {
        let key: CGKeyCode
        let down: Bool
        let flags: CGEventFlags
        let pid: pid_t
    }

    private let expected: [Event] = [
        Event(key: 0x37, down: true, flags: .maskCommand, pid: 12345),
        Event(key: 0x09, down: true, flags: .maskCommand, pid: 12345),
        Event(key: 0x09, down: false, flags: .maskCommand, pid: 12345),
        Event(key: 0x37, down: false, flags: [], pid: 12345),
    ]

    func testPasteReleasesCommandInTheSameTargetProcess() {
        var events: [Event] = []
        let success = CommandPasteShortcut.post(to: 12345) { key, down, flags, pid in
            events.append(Event(key: key, down: down, flags: flags, pid: pid))
            return true
        }
        XCTAssertTrue(success)
        XCTAssertEqual(events, expected)
    }

    func testFailureAtEveryStepStillAttemptsKeyReleases() {
        for failedIndex in expected.indices {
            var events: [Event] = []
            let success = CommandPasteShortcut.post(to: 12345) { key, down, flags, pid in
                events.append(Event(key: key, down: down, flags: flags, pid: pid))
                return events.count - 1 != failedIndex
            }
            XCTAssertFalse(success, "Failure at event \(failedIndex) must be reported")
            XCTAssertEqual(events, expected, "Cleanup must run after failure at event \(failedIndex)")
        }
    }

    func testRepeatedPastesEachEndWithCommandReleased() {
        var events: [Event] = []
        for _ in 0..<3 {
            XCTAssertTrue(CommandPasteShortcut.post(to: 12345) { key, down, flags, pid in
                events.append(Event(key: key, down: down, flags: flags, pid: pid))
                return true
            })
        }
        XCTAssertEqual(events, Array(repeating: expected, count: 3).flatMap { $0 })
    }
}
