import XCTest
@testable import FieldTheory

@MainActor
final class TranscriptStoreTests: XCTestCase {
    func testAutomaticAndManualCapturesSaveWithoutCountdownOrRetroactiveRelease() async throws {
        let db = try Database(path: ":memory:")
        let store = TranscriptStore(db: db, usesCountdown: false)
        let automatic = await store.add(text: "automatic", autoSend: true)
        let manual = await store.add(text: "manual", autoSend: false)
        XCTAssertEqual(automatic?.actionPolicy, "send")
        XCTAssertEqual(manual?.actionPolicy, "no_action")
        await store.reload()
        XCTAssertTrue(store.pendingPrivacyOffers.isEmpty)
        let queued = try await db.query("SELECT dirty FROM transcripts")
        XCTAssertTrue(queued.allSatisfy { $0["dirty"]?.intValue == 1 })
        _ = await store.add(text: "new automatic", autoSend: true)
        XCTAssertEqual(store.items.first(where: { $0.id == manual?.id })?.actionPolicy, "no_action")
        let sent = await store.requestCloudSync(id: try XCTUnwrap(manual).id)
        XCTAssertTrue(sent)
    }

    func testCompleteReceiptIsScopedToCurrentTextRevision() async throws {
        let db = try Database(path: ":memory:")
        let store = TranscriptStore(db: db, usesCountdown: false)
        let created = await store.add(text: "task", autoSend: true)
        let item = try XCTUnwrap(created)
        try await store.recordAgentReceipts([VoiceAgentReceipt(
            transcript_id: item.id, revision: Hashing.sha256Hex(item.text),
            thread_id: "thread", turn_id: "turn", status: "completed")])
        XCTAssertEqual(store.items.first?.currentAgentStatus, "completed")
        let changed = await store.update(item, text: "different task")
        XCTAssertTrue(changed)
        XCTAssertNil(store.items.first?.currentAgentStatus)
        XCTAssertFalse(store.items.first?.wasSentToAgent ?? true)
    }

    private func makeStore() throws -> TranscriptStore {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-tests-\(UUID().uuidString)")
        let db = try Database(path: dir.appendingPathComponent("test.sqlite").path)
        return TranscriptStore(db: db, privacyHoldDurationMs: 1)
    }

    private func finishPrivacyChoices(in store: TranscriptStore) async throws {
        for item in store.pendingPrivacyOffers {
            let began = await store.beginPrivacyWindow(id: item.id)
            XCTAssertTrue(began)
        }
        try await Task.sleep(nanoseconds: 20_000_000)
        await store.reload()
        XCTAssertTrue(store.items.allSatisfy { $0.privacyPolicy == .uploadEligible })
    }

    func testPrivacyWindowStartsOnlyWhenOfferedAndExpiresIndependently() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-privacy-tests-\(UUID().uuidString)")
        let db = try Database(path: dir.appendingPathComponent("test.sqlite").path)
        var now: Int64 = 1_000
        let store = TranscriptStore(
            db: db,
            privacyHoldDurationMs: 10,
            nowMs: { now }
        )
        let firstValue = await store.add(text: "first")
        let secondValue = await store.add(text: "second")
        let first = try XCTUnwrap(firstValue)
        let second = try XCTUnwrap(secondValue)

        XCTAssertEqual(Set(store.pendingPrivacyOffers.map(\.id)), [first.id, second.id])
        let began = await store.beginPrivacyWindow(id: first.id)
        XCTAssertTrue(began)
        XCTAssertEqual(
            store.items.first(where: { $0.id == first.id })?.syncState,
            .privacyHold(expiresAtMs: 1_010)
        )
        XCTAssertEqual(
            store.items.first(where: { $0.id == second.id })?.syncState,
            .awaitingPrivacyOffer
        )

        now = 1_010
        try await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertEqual(
            store.items.first(where: { $0.id == first.id })?.syncState,
            .awaitingUpload
        )
        XCTAssertEqual(
            store.items.first(where: { $0.id == second.id })?.syncState,
            .awaitingPrivacyOffer
        )
    }

    func testRelaunchPreservesDeadlineAndReleasesExpiredHold() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-privacy-relaunch-\(UUID().uuidString)")
        let db = try Database(path: dir.appendingPathComponent("test.sqlite").path)
        var now: Int64 = 1_000
        let firstStore = TranscriptStore(db: db, privacyHoldDurationMs: 7_000, nowMs: { now })
        let itemValue = await firstStore.add(text: "sync after the original deadline")
        let item = try XCTUnwrap(itemValue)
        let began = await firstStore.beginPrivacyWindow(id: item.id)
        XCTAssertTrue(began)

        now = 4_000
        let restored = TranscriptStore(db: db, nowMs: { now })
        await restored.reload()
        XCTAssertEqual(restored.items.first?.syncState, .privacyHold(expiresAtMs: 8_000))
        let repeated = await restored.beginPrivacyWindow(id: item.id)
        XCTAssertTrue(repeated)
        XCTAssertEqual(restored.items.first?.syncState, .privacyHold(expiresAtMs: 8_000))

        now = 9_000
        let expired = TranscriptStore(db: db, nowMs: { now })
        let released = expectation(description: "Expired hold schedules sync after relaunch")
        expired.onLocalChange = { released.fulfill() }
        await expired.reload()
        await fulfillment(of: [released], timeout: 2)
        XCTAssertEqual(expired.items.first?.syncState, .awaitingUpload)
    }

    func testKeepLocalPersistsAcrossEditWithoutRemoteTombstone() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-privacy-local-\(UUID().uuidString)")
        let db = try Database(path: dir.appendingPathComponent("test.sqlite").path)
        let store = TranscriptStore(db: db, privacyHoldDurationMs: 60_000)
        let itemValue = await store.add(text: "private")
        let item = try XCTUnwrap(itemValue)
        let began = await store.beginPrivacyWindow(id: item.id)
        XCTAssertTrue(began)
        let kept = await store.keepLocal(id: item.id)
        XCTAssertTrue(kept)
        let localItem = try XCTUnwrap(store.items.first)
        let edited = await store.update(localItem, text: "private edit")
        XCTAssertTrue(edited)

        let rows = try await db.query(
            "SELECT privacy_state, dirty FROM transcripts WHERE id = ?", [.text(item.id)]
        )
        let row = try XCTUnwrap(rows.first)
        XCTAssertEqual(row["privacy_state"]?.stringValue, "local_only")
        XCTAssertEqual(row["dirty"]?.intValue, 1, "No action still saves edited text to cloud")
        let tombstones = try await db.query("SELECT id FROM transcript_tombstones")
        XCTAssertTrue(tombstones.isEmpty)
    }

    func testExplicitCloudSyncReleasesOnlyChosenLocalTranscript() async throws {
        let store = try makeStore()
        let firstValue = await store.add(text: "share this later")
        let secondValue = await store.add(text: "keep this private")
        let first = try XCTUnwrap(firstValue)
        let second = try XCTUnwrap(secondValue)
        _ = await store.keepLocal(id: first.id)
        _ = await store.keepLocal(id: second.id)
        var requests = 0
        store.onLocalChange = { requests += 1 }
        let queued = await store.requestCloudSync(id: first.id)
        XCTAssertTrue(queued)
        XCTAssertEqual(store.items.first(where: { $0.id == first.id })?.syncState, .awaitingUpload)
        XCTAssertEqual(store.items.first(where: { $0.id == first.id })?.text, first.text)
        XCTAssertGreaterThan(store.items.first(where: { $0.id == first.id })?.updatedAtMs ?? 0, first.updatedAtMs)
        XCTAssertEqual(store.items.first(where: { $0.id == second.id })?.syncState, .localOnly)
        XCTAssertEqual(requests, 1)
        let missing = await store.requestCloudSync(id: "deleted-or-other-workspace")
        XCTAssertFalse(missing)
        XCTAssertEqual(requests, 1)
    }

    func testFailedCloudSyncChoicePreservesLocalOnlyPolicy() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let db = try Database(path: root.appendingPathComponent("test.sqlite").path)
        let store = TranscriptStore(db: db)
        let value = await store.add(text: "still private if the write fails")
        let item = try XCTUnwrap(value)
        _ = await store.keepLocal(id: item.id)
        try await db.run("""
            CREATE TRIGGER reject_cloud_choice BEFORE UPDATE ON transcripts
            WHEN NEW.privacy_state = 'eligible'
            BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END
            """)
        var requests = 0
        store.onLocalChange = { requests += 1 }
        let queued = await store.requestCloudSync(id: item.id)
        XCTAssertFalse(queued)
        await store.reload()
        XCTAssertEqual(store.items.first?.syncState, .localOnly)
        XCTAssertEqual(requests, 0)
    }

    func testPendingAndMixedPrivacyStacksAreRejectedButAllLocalRoundTrips() async throws {
        let store = try makeStore()
        let firstValue = await store.add(text: "one")
        let secondValue = await store.add(text: "two")
        let first = try XCTUnwrap(firstValue)
        let second = try XCTUnwrap(secondValue)
        let pendingStack = await store.stack(ids: [first.id, second.id])
        XCTAssertFalse(pendingStack)

        let keptFirst = await store.keepLocal(id: first.id)
        XCTAssertTrue(keptFirst)
        let mixedStack = await store.stack(ids: [first.id, second.id])
        XCTAssertFalse(mixedStack)
        let keptSecond = await store.keepLocal(id: second.id)
        XCTAssertTrue(keptSecond)
        let localStack = await store.stack(ids: [first.id, second.id])
        XCTAssertTrue(localStack)
        let stack = try XCTUnwrap(store.items.first)
        XCTAssertEqual(stack.syncState, .localOnly)
        let unstacked = await store.unstack(stack)
        XCTAssertTrue(unstacked)
        XCTAssertEqual(store.items.count, 2)
        XCTAssertTrue(store.items.allSatisfy { $0.syncState == .localOnly })
    }

    /// Regression: unstacking must restore every transcription, including the
    /// one whose id the stack row reused.
    func testStackThenUnstackKeepsAllTranscriptions() async throws {
        let store = try makeStore()
        let firstValue = await store.add(text: "alpha")
        let secondValue = await store.add(text: "bravo")
        let thirdValue = await store.add(text: "charlie")
        let first = try XCTUnwrap(firstValue)
        let second = try XCTUnwrap(secondValue)
        let third = try XCTUnwrap(thirdValue)
        try await finishPrivacyChoices(in: store)

        await store.stack(ids: [first.id, second.id, third.id])
        await store.reload()
        XCTAssertEqual(store.items.count, 1)
        guard let stack = store.items.first else { return XCTFail("missing stack") }
        XCTAssertEqual(stack.segments?.count, 3)
        XCTAssertTrue(stack.isStack)

        await store.unstack(stack)
        await store.reload()
        XCTAssertEqual(store.items.count, 3, "unstack lost a transcription")
        XCTAssertEqual(Set(store.items.map(\.text)), ["alpha", "bravo", "charlie"])
    }

    func testStackMergesChronologically() async throws {
        let store = try makeStore()
        let firstValue = await store.add(text: "one")
        let first = try XCTUnwrap(firstValue)
        try await Task.sleep(nanoseconds: 3_000_000) // distinct createdAt ms
        let secondValue = await store.add(text: "two")
        let second = try XCTUnwrap(secondValue)
        try await finishPrivacyChoices(in: store)

        await store.stack(ids: [second.id, first.id])
        await store.reload()
        guard let stack = store.items.first else { return XCTFail("missing stack") }
        // Segments order by createdAt regardless of selection order.
        XCTAssertEqual(stack.text, "one\n\ntwo")
    }

    func testPlainEditAdvancesClockPastPersistedFutureVersion() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-tests-\(UUID().uuidString)")
        let db = try Database(path: dir.appendingPathComponent("test.sqlite").path)
        let store = TranscriptStore(db: db)
        let future = Timestamps.nowMs() + 60_000
        try await db.run("""
            INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
            VALUES ('clocked', 'old', 1, ?, NULL, 0)
            """, [.int(future)])
        await store.reload()
        let staleItem = try XCTUnwrap(store.items.first)

        let saved = await store.update(staleItem, text: "new")

        XCTAssertTrue(saved)
        let rows = try await db.query(
            "SELECT text, updated_at_ms, dirty FROM transcripts WHERE id = 'clocked'"
        )
        let row = try XCTUnwrap(rows.first)
        XCTAssertEqual(row["text"]?.stringValue, "new")
        XCTAssertEqual(row["updated_at_ms"]?.intValue, future + 1)
        XCTAssertEqual(row["dirty"]?.intValue, 1)
    }

    func testSegmentEditPreservesStackIdentityOrderAndBoundaries() async throws {
        let store = try makeStore()
        let firstValue = await store.add(text: "alpha")
        let secondValue = await store.add(text: "bravo")
        let first = try XCTUnwrap(firstValue)
        let second = try XCTUnwrap(secondValue)
        try await finishPrivacyChoices(in: store)
        let stacked = await store.stack(ids: [first.id, second.id])
        XCTAssertTrue(stacked)
        let stack = try XCTUnwrap(store.items.first)
        let originalSegments = try XCTUnwrap(stack.segments)
        var editedSegments = originalSegments
        editedSegments[0].text = "alpha edited"
        editedSegments[1].text = "bravo edited"

        let saved = await store.updateSegments(stack, segments: editedSegments)

        XCTAssertTrue(saved)
        let updated = try XCTUnwrap(store.items.first)
        let persisted = try XCTUnwrap(updated.segments)
        XCTAssertEqual(persisted.map(\.id), originalSegments.map(\.id))
        XCTAssertEqual(persisted.map(\.createdAt), originalSegments.map(\.createdAt))
        XCTAssertEqual(persisted.map(\.text), ["alpha edited", "bravo edited"])
        XCTAssertEqual(updated.text, "alpha edited\n\nbravo edited")
        XCTAssertGreaterThan(updated.updatedAtMs, stack.updatedAtMs)
        XCTAssertGreaterThan(persisted[0].updatedAt, originalSegments[0].updatedAt)
        XCTAssertGreaterThan(persisted[1].updatedAt, originalSegments[1].updatedAt)
    }

    func testSegmentEditRejectsChangedBoundariesWithoutMutation() async throws {
        let store = try makeStore()
        let firstValue = await store.add(text: "alpha")
        let secondValue = await store.add(text: "bravo")
        let first = try XCTUnwrap(firstValue)
        let second = try XCTUnwrap(secondValue)
        try await finishPrivacyChoices(in: store)
        _ = await store.stack(ids: [first.id, second.id])
        let stack = try XCTUnwrap(store.items.first)
        var reordered = try XCTUnwrap(stack.segments)
        reordered.reverse()
        var storageError: String?
        store.onStorageError = { storageError = $0 }

        let saved = await store.updateSegments(stack, segments: reordered)

        XCTAssertFalse(saved)
        XCTAssertTrue(storageError?.contains("segment boundaries changed") == true)
        XCTAssertEqual(store.items.first, stack)
    }

    func testFailedTranscriptSaveReportsErrorAndDoesNotScheduleSync() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-tests-\(UUID().uuidString)")
        let db = try Database(path: dir.appendingPathComponent("test.sqlite").path)
        let store = TranscriptStore(db: db)
        var errorMessage: String?
        var localChangeCount = 0
        store.onStorageError = { errorMessage = $0 }
        store.onLocalChange = { localChangeCount += 1 }
        try await db.run("DROP TABLE transcripts")

        let saved = await store.add(text: "must not disappear silently")

        XCTAssertNil(saved)
        XCTAssertEqual(localChangeCount, 0)
        XCTAssertTrue(errorMessage?.contains("could not be saved") == true)
    }

    func testAccountOwnerSwitchAtomicallyClearsLocalReplica() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-tests-\(UUID().uuidString)")
        let db = try Database(path: dir.appendingPathComponent("test.sqlite").path)
        let adoptedFirstOwner = try await db.activate(ownerID: "account-a")
        XCTAssertFalse(adoptedFirstOwner)
        try await db.run("""
            INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
            VALUES ('private-a', 'account a', 1, 1, NULL, 1)
            """)
        try await db.run("""
            INSERT INTO river_blocked_authors (author_id, author_label, blocked_at_ms)
            VALUES ('author-a', 'A', 1)
            """)

        let retainedSameOwner = try await db.activate(ownerID: "account-a")
        let retainedTranscripts = try await db.query("SELECT id FROM transcripts")
        XCTAssertFalse(retainedSameOwner)
        XCTAssertEqual(retainedTranscripts.count, 1)

        let switchedOwner = try await db.activate(ownerID: "account-b")
        let switchedTranscripts = try await db.query("SELECT id FROM transcripts")
        let switchedBlocks = try await db.query("SELECT author_id FROM river_blocked_authors")
        let activeOwner = try await db.getMeta("storage_owner_user_id")
        let cleanupRequired = try await db.externalCleanupRequired()
        XCTAssertTrue(switchedOwner)
        XCTAssertTrue(switchedTranscripts.isEmpty)
        XCTAssertTrue(switchedBlocks.isEmpty)
        XCTAssertEqual(activeOwner, "account-b")
        XCTAssertTrue(cleanupRequired)
        try await db.markExternalCleanupComplete()
        let cleanupCompleted = try await db.externalCleanupRequired()
        XCTAssertFalse(cleanupCompleted)
    }

    func testInvalidatedSyncLeaseCannotMutateNextAccountsStore() async throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-tests-\(UUID().uuidString)")
        let db = try Database(path: dir.appendingPathComponent("test.sqlite").path)
        let fence = SyncSessionFence()
        let oldLease = fence.activate(userId: "account-a")
        let reachedAwait = expectation(description: "old sync reached await")
        var resume: CheckedContinuation<Void, Never>?

        let oldSync = Task { @MainActor in
            await withCheckedContinuation { continuation in
                resume = continuation
                reachedAwait.fulfill()
            }
            try fence.requireActive(oldLease)
            try await db.run("""
                INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
                VALUES ('late-a', 'old account', 1, 1, NULL, 0)
                """)
        }

        await fulfillment(of: [reachedAwait], timeout: 2)
        fence.invalidate()
        _ = fence.activate(userId: "account-b")
        resume?.resume()

        do {
            try await oldSync.value
            XCTFail("invalidated sync unexpectedly crossed the account boundary")
        } catch is CancellationError {
            // Expected: the post-await fence rejected the stale lease.
        }
        let lateRows = try await db.query("SELECT id FROM transcripts")
        XCTAssertTrue(lateRows.isEmpty)
    }

    func testAuthEventDuringDemoSeedCannotReplaceWorkspaceOrTouchProductionStore() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-app-model-tests-\(UUID().uuidString)")
        let productionRoot = root.appendingPathComponent("production-library")
        let demoRoot = root.appendingPathComponent("reviewer-demo")
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "AppModelRaceTests.\(UUID().uuidString)"))
        let recorder = RecorderController(
            pendingDirectory: root.appendingPathComponent("production-audio"),
            defaults: defaults
        )
        let model = AppModel(
            databasePathOverride: root.appendingPathComponent("production.sqlite").path,
            libraryRootOverride: productionRoot,
            reviewerDemoDatabasePathOverride: root.appendingPathComponent("demo.sqlite").path,
            reviewerDemoRootOverride: demoRoot,
            recorderOverride: recorder,
            startInitialPreparation: false
        )
        let authTransition = model.auth.onPhaseChange
        model.auth.onPhaseChange = nil
        let productionItem = await model.transcripts.add(text: "production private")
        XCTAssertNotNil(productionItem)

        let seedStarted = expectation(description: "demo seed started")
        var finishSeed: CheckedContinuation<Void, Never>?
        let enterDemo = Task { @MainActor in
            try await model.enterReviewerDemo { _, _, transcripts, _ in
                let demoItem = await transcripts.add(text: "reviewer fixture")
                guard demoItem != nil else { throw DatabaseError(message: "fixture failed") }
                seedStarted.fulfill()
                await withCheckedContinuation { finishSeed = $0 }
            }
        }
        await fulfillment(of: [seedStarted], timeout: 2)

        authTransition?(.signedIn(userId: UUID(), email: "other@example.com"))
        finishSeed?.resume()
        try await enterDemo.value

        XCTAssertTrue(model.isReviewerDemoStorage)
        XCTAssertEqual(model.transcripts.items.map(\.text), ["reviewer fixture"])

        await model.exitReviewerDemo()
        XCTAssertFalse(model.isReviewerDemoStorage)
        XCTAssertEqual(model.transcripts.items.map(\.text), ["production private"])
    }

}
