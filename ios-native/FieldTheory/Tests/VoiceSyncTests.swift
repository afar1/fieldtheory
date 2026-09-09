import XCTest
import UIKit
@testable import FieldTheory

@MainActor
private final class RecordingVoiceTransport: VoiceSyncTransport {
    var feedback: [SupportFeedback] = []
    var feedbackError: Error?
    func submitFeedback(_ row: SupportFeedback) async throws {
        if let feedbackError { throw feedbackError }
        feedback.append(row)
    }
    var upsertBatches: [[TranscriptUpsertRow]] = []
    var deletions: [(clientID: String, userID: String, deletedAtMs: Int64)] = []
    var upsertError: Error?
    var deleteError: Error?
    var upsertFailuresRemaining = 0
    var onUpsert: (([TranscriptUpsertRow]) -> Void)?

    func upsert(_ rows: [TranscriptUpsertRow]) async throws {
        upsertBatches.append(rows)
        onUpsert?(rows)
        if upsertFailuresRemaining > 0 {
            upsertFailuresRemaining -= 1
            throw VoiceSyncTestFailure.offline
        }
        if let upsertError { throw upsertError }
    }

    func softDelete(clientID: String, userID: String, deletedAtMs: Int64) async throws {
        deletions.append((clientID, userID, deletedAtMs))
        if let deleteError { throw deleteError }
    }
}

@MainActor
private final class RecordingVoiceBackgroundTasks: VoiceSyncBackgroundTaskManaging {
    var beginCount = 0
    var endCount = 0
    var expirationHandler: (() -> Void)?

    func begin(expirationHandler: @escaping () -> Void) -> UIBackgroundTaskIdentifier {
        beginCount += 1
        self.expirationHandler = expirationHandler
        return .invalid
    }

    func end(_ identifier: UIBackgroundTaskIdentifier) {
        endCount += 1
    }
}

@MainActor
private final class VoiceUploadGate {
    var continuation: CheckedContinuation<Void, Never>?
}

@MainActor
private final class BlockingVoiceTransport: VoiceSyncTransport {
    private let base: RecordingVoiceTransport
    private let gate: VoiceUploadGate
    private var didBlock = false

    init(base: RecordingVoiceTransport, gate: VoiceUploadGate) {
        self.base = base
        self.gate = gate
    }

    func upsert(_ rows: [TranscriptUpsertRow]) async throws {
        try await base.upsert(rows)
        if !didBlock {
            didBlock = true
            await withCheckedContinuation { gate.continuation = $0 }
        }
    }

    func softDelete(clientID: String, userID: String, deletedAtMs: Int64) async throws {
        try await base.softDelete(clientID: clientID, userID: userID, deletedAtMs: deletedAtMs)
    }
}

private enum VoiceSyncTestFailure: Error {
    case offline
}

@MainActor
private final class ExpiringVoiceTransport: VoiceSyncTransport {
    var upsertCount = 0
    var upsertBatches: [[TranscriptUpsertRow]] = []
    var firstUploadStarted: (() -> Void)?

    func upsert(_ rows: [TranscriptUpsertRow]) async throws {
        upsertCount += 1
        upsertBatches.append(rows)
        if upsertCount == 1 {
            firstUploadStarted?()
            try await Task.sleep(nanoseconds: 60_000_000_000)
        }
    }

    func softDelete(clientID: String, userID: String, deletedAtMs: Int64) async throws {}
}

@MainActor
final class VoiceSyncTests: XCTestCase {
    private struct DeleteFixture: Encodable {
        let user_id: String
        let client_id: String
        let patch: TranscriptDeleteUpdate
    }

    private struct WireFixture: Encodable {
        let active: [TranscriptUpsertRow]
        let softDelete: DeleteFixture
    }

    private func makeEngine(
        db: Database,
        transport: RecordingVoiceTransport,
        backgroundTasks: RecordingVoiceBackgroundTasks? = nil,
        transcripts: TranscriptStore? = nil,
        retryDelaySeconds: Double = 10
    ) -> SyncEngine {
        let libraryRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-voice-sync-library-\(UUID().uuidString)")
        return SyncEngine(
            client: SupabaseConfig.makeClient(),
            db: db,
            settings: AppSettings(),
            library: LibraryStore(db: db, libraryRoot: libraryRoot),
            river: RiverStore(db: db),
            transcripts: transcripts ?? TranscriptStore(db: db),
            voiceTransport: transport,
            backgroundTasks: backgroundTasks ?? RecordingVoiceBackgroundTasks(),
            retryDelaySeconds: retryDelaySeconds
        )
    }

    private func makeDatabase() throws -> Database {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-voice-sync-tests-\(UUID().uuidString)")
        return try Database(path: root.appendingPathComponent("test.sqlite").path)
    }

    private func finishPrivacyChoices(in db: Database) async throws {
        let store = TranscriptStore(db: db, privacyHoldDurationMs: 1)
        await store.reload()
        for item in store.pendingPrivacyOffers {
            let began = await store.beginPrivacyWindow(id: item.id)
            XCTAssertTrue(began)
        }
        try await Task.sleep(nanoseconds: 20_000_000)
        let unresolved = try await db.query(
            "SELECT id FROM transcripts WHERE privacy_state != 'eligible'"
        )
        XCTAssertTrue(unresolved.isEmpty)
    }

    private func waitUntil(
        timeoutNanoseconds: UInt64 = 2_000_000_000,
        _ predicate: @escaping @MainActor () -> Bool
    ) async throws {
        let deadline = ContinuousClock.now + .nanoseconds(Int64(timeoutNanoseconds))
        while !predicate() {
            guard ContinuousClock.now < deadline else {
                XCTFail("Timed out waiting for Voice sync state")
                return
            }
            try await Task.sleep(nanoseconds: 2_000_000)
        }
    }

    func testOfflineFeedbackSurvivesReopenAndDeduplicatesThenClearsOnSignOut() async throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("feedback-\(UUID()).sqlite").path
        let owner = UUID()
        let db = try Database(path: path)
        try await db.activate(ownerID: owner.uuidString.lowercased())
        let store = TranscriptStore(db: db)
        let added = await store.add(text: "Please fix this interaction")
        let item = try XCTUnwrap(added)
        _ = await store.keepLocal(id: item.id)
        let transport = RecordingVoiceTransport()
        transport.feedbackError = VoiceSyncTestFailure.offline
        let engine = makeEngine(db: db, transport: transport, transcripts: store)
        await engine.start(userId: owner, email: nil)
        try await engine.queueFeedback(item: item)
        try await engine.queueFeedback(item: item)
        await engine.syncNow()
        await engine.stopAndWait()
        let reopened = try Database(path: path)
        let pending = try await reopened.pendingFeedback(userID: owner.uuidString.lowercased())
        XCTAssertEqual(pending.count, 1)
        XCTAssertEqual(pending.first?.transcript_text, item.text)
        XCTAssertEqual(store.items.first?.actionPolicy, "no_action")
        transport.feedbackError = nil
        let restarted = makeEngine(db: reopened, transport: transport)
        await restarted.start(userId: owner, email: nil)
        await restarted.syncNow()
        let remaining = try await reopened.pendingFeedback(userID: owner.uuidString.lowercased())
        XCTAssertTrue(remaining.isEmpty)
        XCTAssertEqual(transport.feedback.count, 1)
        await restarted.stopAndWait()
        try await reopened.reset()
        let cleared = try await reopened.query("SELECT * FROM support_feedback_outbox")
        XCTAssertTrue(cleared.isEmpty)
        do {
            try await reopened.enqueueFeedback(SupportFeedback(item: item, userID: owner.uuidString.lowercased()))
            XCTFail("Late feedback must be rejected after sign out")
        } catch { }
    }

    func testReconnectUploadsHoursOldSendAndNoActionWithPoliciesIntact() async throws {
        let db = try makeDatabase()
        let created = Timestamps.nowMs() - 8 * 3_600_000
        try await db.run("""
            INSERT INTO transcripts(id, text, created_at_ms, updated_at_ms, dirty, privacy_state, action_protocol)
            VALUES ('offline-send', 'do this later', ?, ?, 1, 'eligible', 1),
                   ('offline-save', 'save only', ?, ?, 1, 'local_only', 1)
            """, [.int(created), .int(created), .int(created), .int(created)])
        let transport = RecordingVoiceTransport()
        transport.upsertError = VoiceSyncTestFailure.offline
        let engine = makeEngine(db: db, transport: transport, retryDelaySeconds: 3600)
        await engine.start(userId: UUID(), email: nil)
        await engine.syncNow()
        transport.upsertError = nil
        let before = transport.upsertBatches.count
        engine.networkPathChanged(isConnected: false)
        engine.networkPathChanged(isConnected: true)
        try await waitUntil { transport.upsertBatches.count > before }
        await engine.syncNow()
        let rows = transport.upsertBatches.suffix(2).flatMap { $0 }
        XCTAssertTrue(rows.contains { $0.client_id == "offline-send" && $0.metadata.actionPolicy == "send" && $0.client_created_at_ms == created })
        XCTAssertTrue(rows.contains { $0.client_id == "offline-save" && $0.metadata.actionPolicy == "no_action" })
        let dirty = try await db.query("SELECT id FROM transcripts WHERE dirty = 1")
        XCTAssertTrue(dirty.isEmpty)
        await engine.stopAndWait()
    }

    func testSwiftWireEncodesMacStackAndSoftDeleteContract() throws {
        let segments = [
            TranscriptSegment(id: "segment-a", text: "first", createdAt: 1_000, updatedAt: 1_100),
            TranscriptSegment(id: "segment-b", text: "second", createdAt: 2_000, updatedAt: 2_100),
        ]
        let item = TranscriptItem(
            id: "phone-stack",
            text: "first\n\nsecond",
            createdAtMs: 1_000,
            updatedAtMs: 3_000,
            segments: segments
        )
        let fixture = WireFixture(
            active: [TranscriptUpsertRow(userID: "user-a", item: item)],
            softDelete: DeleteFixture(
                user_id: "user-a",
                client_id: "phone-deleted",
                patch: TranscriptDeleteUpdate(
                    client_updated_at_ms: 4_000,
                    deleted_at: "1970-01-01T00:00:04.000Z"
                )
            )
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(fixture)
        try data.write(
            to: URL(fileURLWithPath: "/tmp/fieldtheory-native-voice-wire.json"),
            options: .atomic
        )

        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let active = try XCTUnwrap((json["active"] as? [[String: Any]])?.first)
        XCTAssertEqual(active["client_id"] as? String, "phone-stack")
        XCTAssertEqual(active["client_created_at_ms"] as? Int, 1_000)
        XCTAssertEqual(active["client_updated_at_ms"] as? Int, 3_000)
        XCTAssertTrue(active.keys.contains("deleted_at"))
        XCTAssertTrue(active["deleted_at"] is NSNull)

        let metadata = try XCTUnwrap(active["metadata"] as? [String: Any])
        XCTAssertEqual(metadata["source"] as? String, "ios-native")
        let encodedSegments = try XCTUnwrap(metadata["stackSegments"] as? [[String: Any]])
        XCTAssertEqual(encodedSegments.map { $0["id"] as? String }, ["segment-a", "segment-b"])
        XCTAssertEqual(encodedSegments[0]["createdAt"] as? Int, 1_000)
        XCTAssertEqual(encodedSegments[1]["updatedAt"] as? Int, 2_100)

        let softDelete = try XCTUnwrap(json["softDelete"] as? [String: Any])
        let patch = try XCTUnwrap(softDelete["patch"] as? [String: Any])
        XCTAssertEqual(patch["client_updated_at_ms"] as? Int, 4_000)
        XCTAssertEqual(patch["deleted_at"] as? String, "1970-01-01T00:00:04.000Z")
    }

    func testUploadIncludesOnlyDirtyPhoneRowsAndDoesNotReplaceLocalHistory() async throws {
        let db = try makeDatabase()
        try await db.run("""
            INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
            VALUES ('legacy-clean', 'already on this phone', 100, 100, NULL, 0),
                   ('phone-dirty', 'new phone recording', 200, 250, NULL, 1)
            """)
        try await finishPrivacyChoices(in: db)
        let transport = RecordingVoiceTransport()
        let backgroundTasks = RecordingVoiceBackgroundTasks()
        let engine = makeEngine(db: db, transport: transport, backgroundTasks: backgroundTasks)

        await engine.start(userId: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!, email: nil)
        try await waitUntil { !transport.upsertBatches.isEmpty && engine.status == .idle }

        XCTAssertEqual(transport.upsertBatches.flatMap { $0 }.map(\.client_id), ["phone-dirty"])
        let localRows = try await db.query("SELECT id, text, dirty FROM transcripts ORDER BY id")
        XCTAssertEqual(localRows.compactMap { $0["id"]?.stringValue }, ["legacy-clean", "phone-dirty"])
        XCTAssertEqual(localRows.first?["text"]?.stringValue, "already on this phone")
        XCTAssertTrue(localRows.allSatisfy { ($0["dirty"]?.intValue ?? 1) == 0 })
        XCTAssertEqual(backgroundTasks.beginCount, 1)
        XCTAssertEqual(backgroundTasks.endCount, 1)
        await engine.stopAndWait()
    }

    func testExplicitLocalUploadStaysQueuedOfflineThenAcknowledgesRetry() async throws {
        let db = try makeDatabase()
        let store = TranscriptStore(db: db)
        let value = await store.add(text: "share my local transcript")
        let item = try XCTUnwrap(value)
        _ = await store.keepLocal(id: item.id)
        let transport = RecordingVoiceTransport()
        let engine = makeEngine(db: db, transport: transport, transcripts: store)
        await engine.start(userId: UUID(), email: nil)
        await engine.syncNow()
        XCTAssertEqual(transport.upsertBatches.last?.first?.metadata.actionPolicy, "no_action")
        XCTAssertTrue(store.items.first?.isCloudSaved == true)
        XCTAssertFalse(store.items.first?.wasSentToAgent == true)

        transport.upsertError = VoiceSyncTestFailure.offline
        let queued = await store.requestCloudSync(id: item.id)
        XCTAssertTrue(queued)
        await engine.syncNow()
        await store.reload()
        XCTAssertEqual(store.items.first?.syncState, .awaitingUpload)

        transport.upsertError = nil
        _ = await store.requestCloudSync(id: item.id)
        await engine.syncNow()
        await store.reload()
        XCTAssertEqual(store.items.first?.syncState, .synced)
        XCTAssertFalse(transport.upsertBatches.isEmpty)
        XCTAssertEqual(transport.upsertBatches.last?.first?.text, item.text)
        await engine.stopAndWait()
    }

    func testUploadedVersionDoesNotAcknowledgeConcurrentLocalEdit() async throws {
        let db = try makeDatabase()
        try await db.run("""
            INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
            VALUES ('phone-edit', 'first version', 100, 200, NULL, 1)
            """)
        try await finishPrivacyChoices(in: db)
        let transport = RecordingVoiceTransport()
        let uploadStarted = expectation(description: "upload captured first version")
        transport.onUpsert = { rows in
            guard rows.first?.client_updated_at_ms == 200 else { return }
            uploadStarted.fulfill()
        }
        let gate = VoiceUploadGate()
        let blockingTransport = BlockingVoiceTransport(base: transport, gate: gate)
        let engine = SyncEngine(
            client: SupabaseConfig.makeClient(),
            db: db,
            settings: AppSettings(),
            library: LibraryStore(db: db),
            river: RiverStore(db: db),
            transcripts: TranscriptStore(db: db),
            voiceTransport: blockingTransport,
            backgroundTasks: RecordingVoiceBackgroundTasks()
        )

        await engine.start(userId: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!, email: nil)
        await fulfillment(of: [uploadStarted], timeout: 2)
        try await db.run(
            "UPDATE transcripts SET text = 'second version', updated_at_ms = 300, dirty = 1 WHERE id = 'phone-edit'"
        )
        gate.continuation?.resume()
        try await waitUntil { engine.status == .idle && transport.upsertBatches.count == 1 }

        let editRows = try await db.query(
            "SELECT text, updated_at_ms, dirty FROM transcripts WHERE id = 'phone-edit'"
        )
        let row = try XCTUnwrap(editRows.first)
        XCTAssertEqual(row["text"]?.stringValue, "second version")
        XCTAssertEqual(row["updated_at_ms"]?.intValue, 300)
        XCTAssertEqual(row["dirty"]?.intValue, 1, "a later edit must remain queued")
        await engine.stopAndWait()
    }

    func testCloudStorageDuringCountdownDoesNotImplyAgentDispatch() async throws {
        let db = try makeDatabase()
        let store = TranscriptStore(db: db, privacyHoldDurationMs: 60_000)
        let value = await store.add(text: "save this without acting")
        let item = try XCTUnwrap(value)
        let transport = RecordingVoiceTransport()
        let engine = makeEngine(db: db, transport: transport, transcripts: store)
        await engine.start(userId: UUID(), email: nil)
        await engine.syncNow()
        XCTAssertEqual(transport.upsertBatches.last?.first?.metadata.actionPolicy, "pending")
        XCTAssertTrue(store.items.first?.isCloudSaved == true)
        let began = await store.beginPrivacyWindow(id: item.id)
        XCTAssertTrue(began, "Cloud acknowledgement must not disable the action choice")
        let suppressed = await store.keepLocal(id: item.id)
        XCTAssertTrue(suppressed)
        await engine.syncNow()
        XCTAssertEqual(transport.upsertBatches.last?.first?.metadata.actionPolicy, "no_action")
        XCTAssertTrue(store.items.first?.isCloudSaved == true)
        XCTAssertFalse(store.items.first?.wasSentToAgent == true)
        _ = await store.requestCloudSave(id: item.id)
        await engine.syncNow()
        XCTAssertEqual(transport.upsertBatches.last?.first?.metadata.actionPolicy, "no_action")
        await engine.stopAndWait()
    }

    func testAgentTagRequiresReceiptForCurrentTextNotCloudAcknowledgement() async throws {
        let db = try makeDatabase()
        let store = TranscriptStore(db: db)
        let value = await store.add(text: "current revision")
        let item = try XCTUnwrap(value)
        let pending = VoiceAgentReceipt(transcript_id: item.id, revision: Hashing.sha256Hex(item.text),
            thread_id: "thread", turn_id: nil, status: "claimed")
        try await store.recordAgentReceipts([pending])
        XCTAssertFalse(store.items.first?.wasSentToAgent == true)
        let sent = VoiceAgentReceipt(transcript_id: item.id, revision: Hashing.sha256Hex(item.text),
            thread_id: "thread", turn_id: "turn", status: "running")
        try await store.recordAgentReceipts([sent])
        XCTAssertTrue(store.items.first?.wasSentToAgent == true)
        _ = await store.update(item, text: "changed revision")
        XCTAssertFalse(store.items.first?.wasSentToAgent == true)
    }

    func testOldPrivateHistoryIsNotRetroactivelyUploaded() async throws {
        let db = try makeDatabase()
        try await db.run("""
            INSERT INTO transcripts (id,text,created_at_ms,updated_at_ms,dirty,privacy_state)
            VALUES ('old-private','older private recording',1,1,0,'local_only')
            """)
        let transport = RecordingVoiceTransport()
        let engine = makeEngine(db: db, transport: transport)
        await engine.start(userId: UUID(), email: nil)
        await engine.syncNow()
        XCTAssertTrue(transport.upsertBatches.isEmpty)
        await engine.stopAndWait()
    }

    func testLocalEditDuringUploadDispatchesFollowUpVersion() async throws {
        let db = try makeDatabase()
        try await db.run("""
            INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
            VALUES ('phone-edit', 'first version', 100, 200, NULL, 1)
            """)
        try await finishPrivacyChoices(in: db)
        let store = TranscriptStore(db: db)
        await store.reload()
        let firstUploadStarted = expectation(description: "first upload started")
        let base = RecordingVoiceTransport()
        base.onUpsert = { rows in
            if rows.first?.client_updated_at_ms == 200 {
                firstUploadStarted.fulfill()
            }
        }
        let gate = VoiceUploadGate()
        let transport = BlockingVoiceTransport(base: base, gate: gate)
        let engine = SyncEngine(
            client: SupabaseConfig.makeClient(),
            db: db,
            settings: AppSettings(),
            library: LibraryStore(db: db),
            river: RiverStore(db: db),
            transcripts: store,
            voiceTransport: transport,
            backgroundTasks: RecordingVoiceBackgroundTasks(),
            retryDelaySeconds: 0.01
        )

        await engine.start(userId: UUID(uuidString: "44444444-4444-4444-4444-444444444444")!, email: nil)
        await fulfillment(of: [firstUploadStarted], timeout: 2)
        let item = try XCTUnwrap(store.items.first)
        let saved = await store.update(item, text: "second version")
        XCTAssertTrue(saved)
        gate.continuation?.resume()

        try await waitUntil { base.upsertBatches.count == 2 && engine.status == .idle }
        XCTAssertEqual(base.upsertBatches[0].first?.text, "first version")
        XCTAssertEqual(base.upsertBatches[1].first?.text, "second version")
        XCTAssertGreaterThan(
            base.upsertBatches[1].first?.client_updated_at_ms ?? 0,
            base.upsertBatches[0].first?.client_updated_at_ms ?? 0
        )
        let dirty = try await db.query("SELECT dirty FROM transcripts WHERE id = 'phone-edit'")
        XCTAssertEqual(dirty.first?["dirty"]?.intValue, 0)
        await engine.stopAndWait()
    }

    func testFailedUploadAutomaticallyRetriesWithoutLosingDurableRow() async throws {
        let db = try makeDatabase()
        try await db.run("""
            INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
            VALUES ('phone-retry', 'retry me', 100, 200, NULL, 1)
            """)
        try await finishPrivacyChoices(in: db)
        let transport = RecordingVoiceTransport()
        transport.upsertFailuresRemaining = 1
        let engine = makeEngine(
            db: db,
            transport: transport,
            retryDelaySeconds: 0.01
        )

        await engine.start(userId: UUID(uuidString: "55555555-5555-5555-5555-555555555555")!, email: nil)
        try await waitUntil { transport.upsertBatches.count == 2 && engine.status == .idle }

        let retryRows = try await db.query(
            "SELECT dirty FROM transcripts WHERE id = 'phone-retry'"
        )
        let row = try XCTUnwrap(retryRows.first)
        XCTAssertEqual(row["dirty"]?.intValue, 0)
        XCTAssertNotNil(engine.lastSyncAt)
        await engine.stopAndWait()
    }

    func testBackgroundExpirationClearsRunningTaskAndRetries() async throws {
        let db = try makeDatabase()
        try await db.run("""
            INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
            VALUES ('phone-background', 'finish after lock', 100, 200, NULL, 1)
            """)
        try await finishPrivacyChoices(in: db)
        let transport = ExpiringVoiceTransport()
        let backgroundTasks = RecordingVoiceBackgroundTasks()
        let firstUploadStarted = expectation(description: "background upload started")
        transport.firstUploadStarted = { firstUploadStarted.fulfill() }
        let engine = SyncEngine(
            client: SupabaseConfig.makeClient(),
            db: db,
            settings: AppSettings(),
            library: LibraryStore(db: db),
            river: RiverStore(db: db),
            transcripts: TranscriptStore(db: db),
            voiceTransport: transport,
            backgroundTasks: backgroundTasks,
            retryDelaySeconds: 0.01
        )

        await engine.start(userId: UUID(uuidString: "66666666-6666-6666-6666-666666666666")!, email: nil)
        await fulfillment(of: [firstUploadStarted], timeout: 2)
        backgroundTasks.expirationHandler?()

        try await waitUntil { transport.upsertCount == 2 && engine.status == .idle }
        let dirty = try await db.query("SELECT dirty FROM transcripts WHERE id = 'phone-background'")
        XCTAssertEqual(dirty.first?["dirty"]?.intValue, 0)
        XCTAssertGreaterThanOrEqual(backgroundTasks.beginCount, 2)
        XCTAssertGreaterThanOrEqual(backgroundTasks.endCount, 2)
        await engine.stopAndWait()
    }

    func testAccountSwitchWhileUploadIsSuspendedDoesNotClearNewSessionTask() async throws {
        let db = try makeDatabase()
        try await db.run("""
            INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
            VALUES ('phone-switch', 'pending at switch', 100, 200, NULL, 1)
            """)
        try await finishPrivacyChoices(in: db)
        let transport = ExpiringVoiceTransport()
        let firstUploadStarted = expectation(description: "old-account upload started")
        transport.firstUploadStarted = { firstUploadStarted.fulfill() }
        let engine = SyncEngine(
            client: SupabaseConfig.makeClient(),
            db: db,
            settings: AppSettings(),
            library: LibraryStore(db: db),
            river: RiverStore(db: db),
            transcripts: TranscriptStore(db: db),
            voiceTransport: transport,
            backgroundTasks: RecordingVoiceBackgroundTasks(),
            retryDelaySeconds: 0.01
        )
        let oldID = UUID(uuidString: "77777777-7777-7777-7777-777777777777")!
        let newID = UUID(uuidString: "88888888-8888-8888-8888-888888888888")!

        await engine.start(userId: oldID, email: nil)
        await fulfillment(of: [firstUploadStarted], timeout: 2)
        await engine.stopAndWait()
        try await db.transaction([
            ("DELETE FROM transcripts", []),
            ("""
             INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
             VALUES ('phone-new-owner', 'new account note', 300, 400, NULL, 1)
             """, []),
        ])
        try await finishPrivacyChoices(in: db)
        await engine.start(userId: newID, email: nil)

        try await waitUntil { transport.upsertCount == 2 && engine.status == .idle }
        XCTAssertEqual(transport.upsertBatches[0].first?.user_id, oldID.uuidString.lowercased())
        XCTAssertEqual(transport.upsertBatches[1].first?.user_id, newID.uuidString.lowercased())
        let dirty = try await db.query("SELECT dirty FROM transcripts WHERE id = 'phone-new-owner'")
        XCTAssertEqual(dirty.first?["dirty"]?.intValue, 0)
        await engine.stopAndWait()
    }

    func testFailedUploadPreservesDirtyRowsAndTombstonesForRetry() async throws {
        let db = try makeDatabase()
        try await db.run("""
            INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
            VALUES ('phone-pending', 'offline recording', 100, 200, NULL, 1)
            """)
        try await finishPrivacyChoices(in: db)
        try await db.run("""
            INSERT INTO transcript_tombstones (id, deleted_at_ms)
            VALUES ('phone-deleted', 300)
            """)
        let transport = RecordingVoiceTransport()
        transport.deleteError = VoiceSyncTestFailure.offline
        let engine = makeEngine(db: db, transport: transport)

        await engine.start(userId: UUID(uuidString: "33333333-3333-3333-3333-333333333333")!, email: nil)
        try await waitUntil {
            if case .error = engine.status { return true }
            return false
        }

        XCTAssertEqual(transport.deletions.count, 1)
        XCTAssertTrue(transport.upsertBatches.isEmpty, "active rows wait behind the failed deletion")
        let dirty = try await db.query("SELECT id FROM transcripts WHERE dirty != 0")
        let tombstones = try await db.query("SELECT id FROM transcript_tombstones")
        XCTAssertEqual(dirty.first?["id"]?.stringValue, "phone-pending")
        XCTAssertEqual(tombstones.first?["id"]?.stringValue, "phone-deleted")
        XCTAssertNil(engine.lastSyncAt)
        await engine.stopAndWait()
    }
}
