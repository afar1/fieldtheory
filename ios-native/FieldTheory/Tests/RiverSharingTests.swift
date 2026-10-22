import XCTest
@testable import FieldTheory

final class RiverSharingTests: XCTestCase {
    func testEditedTranscriptCreatesNewShareWhileRetryKeepsSameShare() {
        let first = RiverTransport.snapshotID(sourceID: "recording-1", text: "First draft")
        XCTAssertEqual(first, RiverTransport.snapshotID(sourceID: "recording-1", text: "First draft"))
        XCTAssertNotEqual(first, RiverTransport.snapshotID(sourceID: "recording-1", text: "Private revised draft"))
        XCTAssertNotEqual(first, RiverTransport.snapshotID(sourceID: "recording-2", text: "First draft"))
    }
}
