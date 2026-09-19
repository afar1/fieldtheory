import XCTest
@testable import FieldTheory

final class RecordingEvidenceWriterTests: XCTestCase {
    func testOrderedWriterPreservesExistingHistoryAndBoundsIt() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("events.json")
        try JSONSerialization.data(withJSONObject: [["sequence": -1]]).write(to: url)
        let writer = RecordingEvidenceWriter(url: url)
        writer.append(["sequence": 0, "attemptID": "first"])
        await writer.flush()
        let initial = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
        XCTAssertEqual(initial.compactMap { $0["sequence"] as? Int }, [-1, 0])
        for sequence in 1...160 { writer.append(["sequence": sequence, "attemptID": "next"]) }
        await writer.flush()
        let events = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
        XCTAssertEqual(events.count, 150)
        XCTAssertEqual(events.compactMap { $0["sequence"] as? Int }, Array(11...160))
        XCTAssertEqual(events.last?["attemptID"] as? String, "next")
    }
}
