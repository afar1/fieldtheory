import XCTest
@testable import FieldTheory

final class RecordingStartupDiagnosticsTests: XCTestCase {
    func testStageAndGeometryStayTimingOnly() {
        let trace = RecordingStartupTrace()
        trace.mark("test.stage")
        trace.mark("ui.pill-geometry", width: 168, height: 52)
        let snapshot = trace.close()
        XCTAssertEqual(snapshot.events.count, 2)
        XCTAssertGreaterThanOrEqual(snapshot.events[0].milliseconds, 0)
        XCTAssertEqual(snapshot.events[1].width, 168)
        XCTAssertEqual(snapshot.events[1].height, 52)
        XCTAssertEqual(snapshot.droppedEvents, 0)
    }

    func testBufferCapsAndClosedAttemptCannotAcceptLateEvents() {
        let trace = RecordingStartupTrace()
        for _ in 0..<400 { trace.mark("test.stage", width: 1, height: 1) }
        let first = trace.close()
        XCTAssertEqual(first.events.count, 384)
        XCTAssertEqual(first.droppedEvents, 16)
        trace.mark("late", width: 1, height: 1)
        let second = trace.close()
        XCTAssertEqual(second.events.count, 384)
        XCTAssertEqual(second.droppedEvents, 16)
    }

    func testConcurrentStageWritersRemainBoundedAndAttemptsSeparate() {
        let first = RecordingStartupTrace()
        let second = RecordingStartupTrace()
        DispatchQueue.concurrentPerform(iterations: 600) { _ in first.mark("worker", width: 1, height: 1) }
        let snapshot = first.close()
        XCTAssertEqual(snapshot.events.count, 384)
        XCTAssertEqual(snapshot.droppedEvents, 216)
        XCTAssertNotEqual(first.id, second.id)
        XCTAssertTrue(second.close().events.isEmpty)
    }
}
