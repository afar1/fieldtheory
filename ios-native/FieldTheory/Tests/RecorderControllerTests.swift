import XCTest
@testable import FieldTheory

final class RecorderControllerTests: XCTestCase {
    func testPendingSessionsGroupAndSortRecordingSegments() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-pending-audio-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        for name in ["rec-200-10.wav", "rec-100-1.wav", "rec-100-0.wav", "note.txt", "loose.wav"] {
            FileManager.default.createFile(atPath: dir.appendingPathComponent(name).path, contents: Data())
        }

        let sessions = RecorderController.pendingSessions(in: dir)

        XCTAssertEqual(sessions.map(\.id), ["100", "200", "loose"])
        XCTAssertEqual(sessions[0].files.map(\.lastPathComponent), ["rec-100-0.wav", "rec-100-1.wav"])
        XCTAssertEqual(sessions[1].files.map(\.lastPathComponent), ["rec-200-10.wav"])
        XCTAssertEqual(sessions[2].files.map(\.lastPathComponent), ["loose.wav"])
    }
}
