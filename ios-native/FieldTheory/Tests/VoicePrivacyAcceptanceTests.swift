import XCTest
import UIKit
import SQLite3
@testable import FieldTheory

@MainActor
private final class PrivacyAcceptanceTransport: VoiceSyncTransport {
    var upsertBatches: [[TranscriptUpsertRow]] = []
    var deletions: [(String, String, Int64)] = []
    var firstUploadStarted: (() -> Void)?
    var firstUploadContinuation: CheckedContinuation<Void, Never>?
    var failUploadsAfterFirst = false

    func upsert(_ rows: [TranscriptUpsertRow]) async throws {
        upsertBatches.append(rows)
        if upsertBatches.count == 1, firstUploadStarted != nil {
            firstUploadStarted?()
            await withCheckedContinuation { firstUploadContinuation = $0 }
        } else if failUploadsAfterFirst {
            throw PrivacyAcceptanceFailure.offline
        }
    }

    func softDelete(clientID: String, userID: String, deletedAtMs: Int64) async throws {
        deletions.append((clientID, userID, deletedAtMs))
    }
}

@MainActor
private final class PrivacyAcceptanceBackgroundTasks: VoiceSyncBackgroundTaskManaging {
    func begin(expirationHandler: @escaping () -> Void) -> UIBackgroundTaskIdentifier { .invalid }
    func end(_ identifier: UIBackgroundTaskIdentifier) {}
}

private enum PrivacyAcceptanceFailure: Error { case offline }

@MainActor
final class VoicePrivacyAcceptanceTests: XCTestCase {
    func testFailedKeepLocalWriteCannotExpireIntoUpload() async throws {
        let db = try makeDatabase()
        let store = TranscriptStore(db: db, privacyHoldDurationMs: 40)
        let added = await store.add(text: "keep private despite storage failure")
        let item = try XCTUnwrap(added)
        let began = await store.beginPrivacyWindow(id: item.id)
        XCTAssertTrue(began)
        try await db.run("""
            CREATE TRIGGER refuse_local_choice BEFORE UPDATE ON transcripts
            WHEN NEW.privacy_state = 'local_only'
            BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;
            """)
        let kept = await store.keepLocal(id: item.id)
        XCTAssertFalse(kept)
        try await Task.sleep(for: .milliseconds(100))
        await store.reload()
        let transport = PrivacyAcceptanceTransport()
        let engine = makeEngine(db: db, store: store, transport: transport)
        await engine.start(userId: userID, email: nil)
        await engine.syncNow()
        XCTAssertTrue(transport.upsertBatches.isEmpty)
        guard case .privacyHold = store.items.first?.syncState else {
            return XCTFail("Failed privacy write released the hold")
        }
        try await db.run("DROP TRIGGER refuse_local_choice")
        let retried = await store.keepLocal(id: item.id)
        XCTAssertTrue(retried)
        XCTAssertEqual(store.items.first?.syncState, .localOnly)
        await engine.stopAndWait()
    }

    private let userID = UUID(uuidString: "11111111-1111-1111-1111-111111111111")!

    private func makeDatabase() throws -> Database {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-privacy-acceptance-\(UUID().uuidString).sqlite")
        return try Database(path: url.path)
    }

    private func makeEngine(
        db: Database,
        store: TranscriptStore,
        transport: PrivacyAcceptanceTransport,
        retryDelaySeconds: Double = 10
    ) -> SyncEngine {
        SyncEngine(
            client: SupabaseConfig.makeClient(),
            db: db,
            settings: AppSettings(),
            library: LibraryStore(db: db),
            river: RiverStore(db: db),
            transcripts: store,
            voiceTransport: transport,
            backgroundTasks: PrivacyAcceptanceBackgroundTasks(),
            retryDelaySeconds: retryDelaySeconds
        )
    }

    private func waitUntil(
        timeout: Duration = .seconds(2),
        _ predicate: @escaping @MainActor () -> Bool
    ) async throws {
        let deadline = ContinuousClock.now + timeout
        while !predicate() {
            guard ContinuousClock.now < deadline else {
                XCTFail("Timed out waiting for privacy acceptance state")
                return
            }
            try await Task.sleep(for: .milliseconds(2))
        }
    }

    func testNeverOfferedRecordingCannotUploadEvenOnManualSync() async throws {
        let db = try makeDatabase()
        let store = TranscriptStore(db: db)
        let added = await store.add(text: "never shown")
        let item = try XCTUnwrap(added)
        let transport = PrivacyAcceptanceTransport()
        let engine = makeEngine(db: db, store: store, transport: transport)

        await engine.start(userId: userID, email: nil)
        await engine.syncNow()

        XCTAssertTrue(transport.upsertBatches.isEmpty)
        XCTAssertEqual(store.items.first(where: { $0.id == item.id })?.syncState, .awaitingPrivacyOffer)
        await engine.stopAndWait()
    }

    func testActivePrivacyHoldBlocksManualRefresh() async throws {
        let db = try makeDatabase()
        let store = TranscriptStore(db: db, privacyHoldDurationMs: 60_000)
        let added = await store.add(text: "still deciding")
        let item = try XCTUnwrap(added)
        let began = await store.beginPrivacyWindow(id: item.id)
        XCTAssertTrue(began)
        let transport = PrivacyAcceptanceTransport()
        let engine = makeEngine(db: db, store: store, transport: transport)

        await engine.start(userId: userID, email: nil)
        await engine.syncNow()

        XCTAssertTrue(transport.upsertBatches.isEmpty)
        guard case .privacyHold = store.items.first(where: { $0.id == item.id })?.syncState else {
            return XCTFail("manual sync ended the privacy hold")
        }
        await engine.stopAndWait()
    }

    func testDefaultPrivacyWindowIsSevenSeconds() async throws {
        let db = try makeDatabase()
        let now: Int64 = 10_000
        let store = TranscriptStore(db: db, nowMs: { now })
        let added = await store.add(text: "seven seconds")
        let item = try XCTUnwrap(added)
        let began = await store.beginPrivacyWindow(id: item.id)
        XCTAssertTrue(began)

        guard case .privacyHold(let deadline) = store.items.first?.syncState else {
            return XCTFail("the default privacy window did not begin")
        }
        XCTAssertEqual(deadline - now, 7_000)
    }

    func testRecordingsReceiveIndependentPrivacyWindows() async throws {
        let db = try makeDatabase()
        let store = TranscriptStore(db: db, privacyHoldDurationMs: 200)
        let firstAdded = await store.add(text: "first")
        let first = try XCTUnwrap(firstAdded)
        let beganFirst = await store.beginPrivacyWindow(id: first.id)
        XCTAssertTrue(beganFirst)
        try await Task.sleep(for: .milliseconds(150))
        let secondAdded = await store.add(text: "second")
        let second = try XCTUnwrap(secondAdded)
        let beganSecond = await store.beginPrivacyWindow(id: second.id)
        XCTAssertTrue(beganSecond)
        try await Task.sleep(for: .milliseconds(100))
        await store.reload()

        XCTAssertEqual(store.items.first(where: { $0.id == first.id })?.syncState, .awaitingUpload)
        guard case .privacyHold = store.items.first(where: { $0.id == second.id })?.syncState else {
            return XCTFail("the second recording inherited the first recording's deadline")
        }
    }

    func testKeepLocalSurvivesRelaunchAndEdit() async throws {
        let db = try makeDatabase()
        let firstStore = TranscriptStore(db: db, privacyHoldDurationMs: 60_000)
        let added = await firstStore.add(text: "private first draft")
        let original = try XCTUnwrap(added)
        let began = await firstStore.beginPrivacyWindow(id: original.id)
        XCTAssertTrue(began)
        let kept = await firstStore.keepLocal(id: original.id)
        XCTAssertTrue(kept)

        let relaunchedStore = TranscriptStore(db: db)
        await relaunchedStore.reload()
        let relaunched = try XCTUnwrap(relaunchedStore.items.first(where: { $0.id == original.id }))
        XCTAssertEqual(relaunched.syncState, .localOnly)
        let edited = await relaunchedStore.update(relaunched, text: "private edited draft")
        XCTAssertTrue(edited)

        let rows = try await db.query(
            "SELECT privacy_state, dirty FROM transcripts WHERE id = ?", [.text(original.id)]
        )
        let row = try XCTUnwrap(rows.first)
        XCTAssertEqual(row["privacy_state"]?.stringValue, "local_only")
        XCTAssertEqual(row["dirty"]?.intValue, 0)
    }

    func testStaleStackSnapshotCannotUndoLocalOnlyWhenUnstacking() async throws {
        let db = try makeDatabase()
        let store = TranscriptStore(db: db, privacyHoldDurationMs: 60_000)
        let segments = [
            TranscriptSegment(id: "first", text: "private one", createdAt: 100, updatedAt: 100),
            TranscriptSegment(id: "second", text: "private two", createdAt: 200, updatedAt: 200),
        ]
        let segmentData = try JSONEncoder().encode(segments)
        let segmentJSON = try XCTUnwrap(String(data: segmentData, encoding: .utf8))
        try await db.run("""
            INSERT INTO transcripts (
                id, text, created_at_ms, updated_at_ms, segments_json, dirty,
                privacy_state, privacy_deadline_at_ms, acknowledged_updated_at_ms,
                cloud_exposure_updated_at_ms, upload_claim_token
            ) VALUES ('stack', 'private one\n\nprivate two', 100, 200, ?, 1,
                      'pending', NULL, NULL, NULL, NULL)
            """, [.text(segmentJSON)])
        await store.reload()
        let staleStack = try XCTUnwrap(store.items.first)

        let kept = await store.keepLocal(id: staleStack.id)
        XCTAssertTrue(kept)
        let unstacked = await store.unstack(staleStack)
        XCTAssertFalse(unstacked)

        XCTAssertEqual(store.items.map(\.id), ["stack"])
        XCTAssertEqual(store.items.first?.syncState, .localOnly)
        let eligible = try await db.query(
            "SELECT id FROM transcripts WHERE privacy_state != 'local_only' OR dirty != 0"
        )
        XCTAssertTrue(eligible.isEmpty)
    }

    func testLegacyDirtyMigrationKeepsPriorUploadBehaviorButMarksPossibleExposure() async throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-privacy-legacy-\(UUID().uuidString).sqlite")
        var handle: OpaquePointer?
        XCTAssertEqual(sqlite3_open(url.path, &handle), SQLITE_OK)
        let legacySQL = """
            CREATE TABLE transcripts (
                id TEXT PRIMARY KEY, text TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
                segments_json TEXT, dirty INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO transcripts VALUES ('dirty', 'retry', 100, 200, NULL, 1);
            INSERT INTO transcripts VALUES ('clean', 'sent', 100, 150, NULL, 0);
            """
        XCTAssertEqual(sqlite3_exec(handle, legacySQL, nil, nil, nil), SQLITE_OK)
        sqlite3_close(handle)

        let db = try Database(path: url.path)
        let rows = try await db.query("""
            SELECT id, privacy_state, acknowledged_updated_at_ms,
                   cloud_exposure_updated_at_ms
            FROM transcripts ORDER BY id
            """)
        let clean = try XCTUnwrap(rows.first(where: { $0["id"]?.stringValue == "clean" }))
        let dirty = try XCTUnwrap(rows.first(where: { $0["id"]?.stringValue == "dirty" }))

        XCTAssertEqual(clean["privacy_state"]?.stringValue, "eligible")
        XCTAssertEqual(clean["acknowledged_updated_at_ms"]?.intValue, 150)
        XCTAssertEqual(clean["cloud_exposure_updated_at_ms"]?.intValue, 150)
        XCTAssertEqual(dirty["privacy_state"]?.stringValue, "eligible")
        XCTAssertNil(dirty["acknowledged_updated_at_ms"]?.intValue)
        XCTAssertEqual(dirty["cloud_exposure_updated_at_ms"]?.intValue, 200)
    }

    func testOldUploadAcknowledgementCannotMarkNewEditSynced() async throws {
        let db = try makeDatabase()
        try await db.run("""
            INSERT INTO transcripts (
                id, text, created_at_ms, updated_at_ms, segments_json, dirty,
                privacy_state, privacy_deadline_at_ms, acknowledged_updated_at_ms,
                cloud_exposure_updated_at_ms, upload_claim_token
            ) VALUES ('edit-race', 'first revision', 100, 200, NULL, 1,
                      'eligible', NULL, NULL, NULL, NULL)
            """)
        let store = TranscriptStore(db: db)
        await store.reload()
        let transport = PrivacyAcceptanceTransport()
        transport.failUploadsAfterFirst = true
        let firstStarted = expectation(description: "first revision dispatched")
        transport.firstUploadStarted = { firstStarted.fulfill() }
        let engine = makeEngine(
            db: db, store: store, transport: transport, retryDelaySeconds: 60
        )

        await engine.start(userId: userID, email: nil)
        await fulfillment(of: [firstStarted], timeout: 2)
        let firstRevision = try XCTUnwrap(store.items.first)
        let savedEdit = await store.update(firstRevision, text: "second revision")
        XCTAssertTrue(savedEdit)
        transport.firstUploadContinuation?.resume()
        try await waitUntil { transport.upsertBatches.count >= 2 }
        await store.reload()

        let editedItem = try XCTUnwrap(store.items.first)
        XCTAssertEqual(editedItem.text, "second revision")
        XCTAssertEqual(editedItem.syncState, .awaitingUpload)
        XCTAssertNotEqual(editedItem.acknowledgedUpdatedAtMs, editedItem.updatedAtMs)
        await engine.stopAndWait()
    }

    func testMixedLocalOnlyStackIsRejectedAndPrivateTextNeverEntersWireSnapshot() async throws {
        let db = try makeDatabase()
        let store = TranscriptStore(db: db, privacyHoldDurationMs: 60_000)
        let privateAdded = await store.add(text: "private phrase")
        let privateItem = try XCTUnwrap(privateAdded)
        let began = await store.beginPrivacyWindow(id: privateItem.id)
        XCTAssertTrue(began)
        let kept = await store.keepLocal(id: privateItem.id)
        XCTAssertTrue(kept)
        let publicAdded = await store.add(text: "public phrase")
        let publicItem = try XCTUnwrap(publicAdded)
        try await db.run("""
            UPDATE transcripts
            SET privacy_state = 'eligible', privacy_deadline_at_ms = NULL, dirty = 1
            WHERE id = ?
            """, [.text(publicItem.id)])
        await store.reload()

        let stacked = await store.stack(ids: [privateItem.id, publicItem.id])
        XCTAssertFalse(stacked)
        let transport = PrivacyAcceptanceTransport()
        let engine = makeEngine(db: db, store: store, transport: transport)
        await engine.start(userId: userID, email: nil)
        try await waitUntil { !transport.upsertBatches.isEmpty }

        let wire = transport.upsertBatches.flatMap { $0 }
        XCTAssertEqual(wire.map(\.text), ["public phrase"])
        XCTAssertFalse(wire.contains(where: { $0.text.contains("private phrase") }))
        XCTAssertEqual(store.items.first(where: { $0.id == privateItem.id })?.syncState, .localOnly)
        await engine.stopAndWait()
    }
}
