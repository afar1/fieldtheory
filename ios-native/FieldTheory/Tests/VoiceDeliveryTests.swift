import XCTest
@testable import FieldTheory

final class VoiceDeliveryTests: XCTestCase {
    private var item: TranscriptItem {
        TranscriptItem(id: "note", text: "Test", createdAtMs: 1, updatedAtMs: 2, segments: nil, acknowledgedUpdatedAtMs: 2)
    }
    private func event(_ stage: String, revision: String? = nil) -> VoiceDeliveryEvent {
        VoiceDeliveryEvent(event_id: stage, transcript_id: "note", revision: revision ?? Hashing.sha256Hex("Test"), stage: stage, occurred_at: "2026-09-09T20:00:00Z", worker_id: nil)
    }
    func testUsableBlockedResultCompletesRunButTransportFailureDoesNot() {
        var receipt = VoiceAgentReceipt(transcript_id: "note", revision: Hashing.sha256Hex("Test"), thread_id: "thread", turn_id: "turn", status: "failed")
        XCTAssertEqual(VoiceDelivery.status(item: item, events: [event("failed")], receipt: receipt), "Failed")
        receipt.final_response = "I inspected the code, but filesystem permissions prevent applying the fix."
        XCTAssertEqual(VoiceDelivery.status(item: item, events: [event("failed")], receipt: receipt), "Complete")
        receipt.final_response = "  \n "
        XCTAssertEqual(VoiceDelivery.status(item: item, events: [event("failed")], receipt: receipt), "Failed")
    }
    func testNonterminalResultDoesNotFinishRunningTaskAndOldResultCannotFinishNewRevision() {
        var receipt = VoiceAgentReceipt(transcript_id: "note", revision: Hashing.sha256Hex("Test"), thread_id: "thread", turn_id: "turn", status: "running")
        receipt.final_response = "intermediate content"
        XCTAssertEqual(VoiceDelivery.status(item: item, events: [], receipt: receipt), "Working")
        var old = VoiceAgentReceipt(transcript_id: "note", revision: "old", thread_id: "thread", turn_id: "turn", status: "failed")
        old.final_response = "usable older result"
        XCTAssertEqual(VoiceDelivery.status(item: item, events: [], receipt: old), "Uploaded")
    }
    func testProgressAnimationOnlyUsesActiveStages() {
        for status in ["Saved on phone", "Uploaded", "Received by Mac", "Queued in Codex", "Working"] { XCTAssertTrue(VoiceDelivery.isInProgress(status)) }
        for status in ["Complete", "Failed", "Send to agent", "Cancelled", "Needs you", "Saved as context"] { XCTAssertFalse(VoiceDelivery.isInProgress(status)) }
    }

    func testStorageOnlyUploadStillOffersSendAndDoesNotAnimate() {
        var saved = item
        saved.privacyPolicy = .localOnly
        let status = VoiceDelivery.status(item: saved, events: [event("uploaded")], receipt: nil)
        XCTAssertEqual(status, "Send to agent")
        XCTAssertFalse(VoiceDelivery.isInProgress(status))
    }

    func testRunningWithoutTurnIsOnlyUploaded() {
        let receipt = VoiceAgentReceipt(transcript_id: "note", revision: Hashing.sha256Hex("Test"), thread_id: "thread", turn_id: nil, status: "running")
        XCTAssertEqual(VoiceDelivery.status(item: item, events: [], receipt: receipt), "Uploaded")
    }
    func testTerminalReceiptWinsOverPartialOlderEvents() {
        let receipt = VoiceAgentReceipt(transcript_id: "note", revision: Hashing.sha256Hex("Test"), thread_id: "thread", turn_id: "turn", status: "completed")
        XCTAssertEqual(VoiceDelivery.status(item: item, events: [event("queued")], receipt: receipt), "Complete")
    }
    func testOldRevisionDoesNotAcknowledgeCurrentText() {
        XCTAssertEqual(VoiceDelivery.status(item: item, events: [event("completed", revision: "old")], receipt: nil), "Uploaded")
    }
    func testTerminalEventWinsOverOlderRunningReceipt() {
        let receipt = VoiceAgentReceipt(transcript_id: "note", revision: Hashing.sha256Hex("Test"), thread_id: "thread", turn_id: "turn", status: "running")
        XCTAssertEqual(VoiceDelivery.status(item: item, events: [event("completed")], receipt: receipt), "Complete")
    }
    @MainActor
    func testTargetedRefreshPreservesOtherTimelinesAndSignOutClearsThem() throws {
        let db = try Database(path: ":memory:")
        let store = TranscriptStore(db: db)
        let other = VoiceDeliveryEvent(event_id: "other", transcript_id: "older", revision: "r", stage: "queued", occurred_at: "2026-09-09T20:00:00Z", worker_id: nil)
        store.updateDelivery(receipts: [], events: [event("started"), other], presence: [], runnerEvents: [])
        store.updateDelivery(receipts: [], events: [event("completed")], presence: nil, runnerEvents: nil, replacingIDs: ["note"])
        XCTAssertEqual(Set(store.deliveryEvents.map(\.stage)), ["completed", "queued"])
        store.clearDelivery()
        XCTAssertTrue(store.deliveryEvents.isEmpty)
        XCTAssertNil(store.deliveryRefreshedAt)
    }
    func testQueueAcceptanceDoesNotMeanWorking() {
        XCTAssertEqual(VoiceDelivery.status(item: item, events: [event("queued")], receipt: nil), "Queued in Codex")
        XCTAssertEqual(VoiceDelivery.status(item: item, events: [event("started")], receipt: nil), "Working")
    }
}
