import Foundation
import UIKit
import Observation

/// Voice items ("stacks"). Mirrors the data shape the previous mobile app
/// synced to the `transcripts` table, including camelCase stackSegments in
/// the metadata JSON.
@MainActor
@Observable
final class TranscriptStore {
    private let db: Database
    private let privacyHoldDurationMs: Int64
    private let nowMs: @MainActor () -> Int64
    private var privacyTimers: [String: (deadline: Int64, token: UUID, task: Task<Void, Never>)] = [:]
    private var privacySuppressedIDs = Set<String>()
    private var performedInitialPrivacyRecovery = false
    private var initialPrivacyRecoveryTask: Task<Void, Error>?

    private(set) var feedbackStates: [String: Bool] = [:]

    func feedbackState(for item: TranscriptItem) -> Bool? {
        feedbackStates[item.id + ":" + Hashing.sha256Hex(item.text)]
    }

    private(set) var deliveryEvents: [VoiceDeliveryEvent] = []
    private(set) var deliveryReceipts: [VoiceAgentReceipt] = []
    private(set) var runnerPresence: [VoiceRunnerPresence] = []
    private(set) var runnerEvents: [VoiceRunnerEvent] = []
    private(set) var deliveryRefreshedAt: Date?

    func events(for item: TranscriptItem) -> [VoiceDeliveryEvent] {
        deliveryEvents.filter { $0.transcript_id == item.id && $0.revision == Hashing.sha256Hex(item.text) }
            .sorted { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }
    }

    func receipt(for item: TranscriptItem) -> VoiceAgentReceipt? {
        deliveryReceipts.last { $0.transcript_id == item.id && $0.revision == Hashing.sha256Hex(item.text) }
    }

    func updateDelivery(receipts: [VoiceAgentReceipt], events: [VoiceDeliveryEvent]?, presence: [VoiceRunnerPresence]?, runnerEvents: [VoiceRunnerEvent]?, replacingIDs: Set<String>? = nil) {
        if let replacingIDs {
            deliveryReceipts.removeAll { replacingIDs.contains($0.transcript_id) }
            deliveryReceipts.append(contentsOf: receipts)
            if let events {
                deliveryEvents.removeAll { replacingIDs.contains($0.transcript_id) }
                deliveryEvents.append(contentsOf: events)
            }
        } else {
            deliveryReceipts = receipts
            if let events { deliveryEvents = events }
        }
        if let presence { self.runnerPresence = presence }
        if let runnerEvents { self.runnerEvents = runnerEvents }
        deliveryRefreshedAt = Date()
    }

    func clearDelivery() {
        deliveryEvents = []
        deliveryReceipts = []
        runnerPresence = []
        runnerEvents = []
        deliveryRefreshedAt = nil
    }

    private(set) var items: [TranscriptItem] = []

    var pendingPrivacyOffers: [TranscriptItem] {
        items.filter { item in
            guard item.actionProtocol || item.cloudExposureUpdatedAtMs == nil else { return false }
            switch item.syncState {
            case .awaitingPrivacyOffer, .privacyHold: return true
            case .localOnly, .awaitingUpload, .synced: return false
            }
        }
    }

    var onLocalChange: (() -> Void)?
    var onStorageError: ((String) -> Void)?

    init(
        db: Database,
        privacyHoldDurationMs: Int64 = 7_000,
        nowMs: @escaping @MainActor () -> Int64 = Timestamps.nowMs
    ) {
        self.db = db
        self.privacyHoldDurationMs = privacyHoldDurationMs
        self.nowMs = nowMs
    }

    func reload() async {
        do {
            try await performInitialPrivacyRecoveryIfNeeded()
            let rows = try await db.query("SELECT * FROM transcripts ORDER BY created_at_ms DESC")
            items = rows.map(Self.itemFromRow)
            let feedback = try await db.query("SELECT transcript_id, revision, sent FROM support_feedback_outbox")
            feedbackStates = Dictionary(uniqueKeysWithValues: feedback.compactMap { row in
                guard let id = row["transcript_id"]?.stringValue, let revision = row["revision"]?.stringValue else { return nil }
                return (id + ":" + revision, row["sent"]?.intValue == 1)
            })
            reconcilePrivacyTimers()
        } catch {
            items = []
            report("Voice notes could not be loaded. Existing recordings and notes were left unchanged.", error: error)
        }
    }

    private static func itemFromRow(_ row: [String: SQLValue]) -> TranscriptItem {
        var segments: [TranscriptSegment]?
        if let json = row["segments_json"]?.stringValue, let data = json.data(using: .utf8) {
            segments = try? JSONDecoder().decode([TranscriptSegment].self, from: data)
        }
        return TranscriptItem(
            id: row["id"]?.stringValue ?? "",
            text: row["text"]?.stringValue ?? "",
            createdAtMs: row["created_at_ms"]?.intValue ?? 0,
            updatedAtMs: row["updated_at_ms"]?.intValue ?? 0,
            segments: segments,
            privacyPolicy: TranscriptPrivacyPolicy(
                rawValue: row["privacy_state"]?.stringValue ?? "eligible"
            ) ?? .awaitingOffer,
            privacyDeadlineAtMs: row["privacy_deadline_at_ms"]?.intValue,
            acknowledgedUpdatedAtMs: row["acknowledged_updated_at_ms"]?.intValue,
            cloudExposureUpdatedAtMs: row["cloud_exposure_updated_at_ms"]?.intValue,
            actionProtocol: row["action_protocol"]?.intValue == 1,
            agentSentRevision: row["agent_sent_revision"]?.stringValue
        )
    }

    /// Starts the hold only after the UI has actually rendered its affordance.
    /// Repeated appearances are idempotent and never extend an active window.
    @discardableResult
    func beginPrivacyWindow(id: String) async -> Bool {
        guard !privacySuppressedIDs.contains(id) else { return false }
        let start = nowMs()
        let deadline = start > Int64.max - privacyHoldDurationMs
            ? Int64.max : start + privacyHoldDurationMs
        do {
            try await performInitialPrivacyRecoveryIfNeeded()
            let changed = try await db.query("""
                UPDATE transcripts
                SET privacy_state = 'holding', privacy_deadline_at_ms = ?
                WHERE id = ? AND privacy_state = 'pending'
                  AND privacy_deadline_at_ms IS NULL
                  AND (action_protocol = 1 OR upload_claim_token IS NULL)
                RETURNING id
                """, [.int(deadline), .text(id)])
            await reload()
            if !changed.isEmpty {
                schedulePrivacyTimer(id: id, deadline: deadline, delayMs: max(0, deadline - nowMs()))
                return true
            }
            return items.first(where: { $0.id == id }).map {
                if case .privacyHold = $0.syncState { return true }
                return $0.syncState == .localOnly
            } ?? false
        } catch {
            report("The local-only window could not be started. This recording remains blocked from sync.", error: error)
            return false
        }
    }

    /// Permanently excludes an unexpired, unclaimed recording from upload.
    @discardableResult
    func keepLocal(id: String) async -> Bool {
        // Intent wins in memory before the first await. If SQLite fails, the
        // active hold cannot later expire and upload behind the failed action.
        privacySuppressedIDs.insert(id)
        privacyTimers.removeValue(forKey: id)?.task.cancel()
        do {
            try await performInitialPrivacyRecoveryIfNeeded()
            let now = try await nextMutationTimestamp(forIDs: [id])
            let changed = try await db.query("""
                UPDATE transcripts
                SET privacy_state = 'local_only', privacy_deadline_at_ms = NULL,
                    dirty = CASE WHEN action_protocol = 1 THEN 1 ELSE 0 END,
                    updated_at_ms = CASE WHEN action_protocol = 1 THEN ? ELSE updated_at_ms END,
                    upload_claim_token = NULL
                WHERE id = ? AND privacy_state IN ('pending', 'holding')
                  AND (action_protocol = 1 OR (upload_claim_token IS NULL
                    AND acknowledged_updated_at_ms IS NULL AND cloud_exposure_updated_at_ms IS NULL))
                RETURNING id
                """, [.int(now), .text(id)])
            await reload()
            guard !changed.isEmpty,
                  items.first(where: { $0.id == id })?.syncState == .localOnly else {
                return false
            }
            privacySuppressedIDs.remove(id)
            onLocalChange?()
            return true
        } catch {
            report("The No action choice could not be saved. Agent dispatch remains blocked on this device.", error: error)
            return false
        }
    }

    @discardableResult
    func requestCloudSave(id: String) async -> Bool {
        do {
            let now = try await nextMutationTimestamp(forIDs: [id])
            let rows = try await db.query("""
                UPDATE transcripts SET action_protocol = 1, dirty = 1,
                    updated_at_ms = ?, upload_claim_token = NULL
                WHERE id = ? RETURNING id
                """, [.int(now), .text(id)])
            await reload()
            if !rows.isEmpty { onLocalChange?() }
            return !rows.isEmpty
        } catch {
            report("The transcript could not be queued for cloud storage. Its action choice is unchanged.", error: error)
            return false
        }
    }

    /// Explicitly reverses No action, or requests an immediate retry. Merely
    /// opening the badge menu never changes the persisted privacy choice.
    @discardableResult
    func requestCloudSync(id: String) async -> Bool {
        do {
            try await performInitialPrivacyRecoveryIfNeeded()
            let now = try await nextMutationTimestamp(forIDs: [id])
            let changed = try await db.query("""
                UPDATE transcripts
                SET privacy_state = 'eligible', privacy_deadline_at_ms = NULL, dirty = 1,
                    action_protocol = 1, updated_at_ms = ?, upload_claim_token = NULL
                WHERE id = ?
                  AND (privacy_state != 'eligible' OR acknowledged_updated_at_ms IS NULL
                       OR acknowledged_updated_at_ms != updated_at_ms)
                RETURNING id
                """, [.int(now), .text(id)])
            if !changed.isEmpty {
                privacySuppressedIDs.remove(id)
                privacyTimers.removeValue(forKey: id)?.task.cancel()
            }
            await reload()
            guard let item = items.first(where: { $0.id == id }),
                  item.privacyPolicy == .uploadEligible else { return false }
            // The existing sync engine owns auth, upload claims and retries.
            // A queued or in-flight revision is not yet "Cloud synced".
            onLocalChange?()
            return true
        } catch {
            report("This transcript could not be queued for cloud sync. Its local copy was kept.", error: error)
            return false
        }
    }

    func recordAgentReceipts(_ receipts: [VoiceAgentReceipt]) async throws {
        for receipt in receipts where receipt.confirmed {
            try await db.run("UPDATE transcripts SET agent_sent_revision = ? WHERE id = ?",
                             [.text(receipt.revision), .text(receipt.transcript_id)])
        }
        if !receipts.isEmpty { await reload() }
    }

    private func performInitialPrivacyRecoveryIfNeeded() async throws {
        guard !performedInitialPrivacyRecovery else { return }
        if let initialPrivacyRecoveryTask {
            try await initialPrivacyRecoveryTask.value
            return
        }
        let db = self.db
        let task = Task { try await db.run("""
            UPDATE transcripts
            SET privacy_state = 'pending', privacy_deadline_at_ms = NULL,
                upload_claim_token = NULL
            WHERE privacy_state = 'holding' AND privacy_deadline_at_ms IS NULL
            """) }
        initialPrivacyRecoveryTask = task
        do {
            try await task.value
            performedInitialPrivacyRecovery = true
            initialPrivacyRecoveryTask = nil
        } catch {
            initialPrivacyRecoveryTask = nil
            throw error
        }
    }

    private func reconcilePrivacyTimers() {
        let active = Dictionary(uniqueKeysWithValues: items.compactMap { item -> (String, Int64)? in
            guard case .privacyHold(let deadline) = item.syncState else { return nil }
            return (item.id, deadline)
        })
        let obsoleteTimerIDs = privacyTimers.compactMap { id, timer in
            active[id] == timer.deadline ? nil : id
        }
        for id in obsoleteTimerIDs {
            privacyTimers.removeValue(forKey: id)?.task.cancel()
        }
        // Restore the original absolute deadline after suspension or relaunch.
        // Only a hold with no durable deadline needs to be offered again.
        for (id, deadline) in active
        where privacyTimers[id] == nil && !privacySuppressedIDs.contains(id) {
            schedulePrivacyTimer(id: id, deadline: deadline, delayMs: max(0, deadline - nowMs()))
        }
    }

    private func schedulePrivacyTimer(id: String, deadline: Int64, delayMs: Int64) {
        privacyTimers[id]?.task.cancel()
        let token = UUID()
        // Start while foregrounded; the seven-second choice and the sync
        // handoff must survive switching apps. SyncEngine owns upload time.
        let backgroundID = UIApplication.shared.beginBackgroundTask(
            withName: "Voice sync countdown"
        ) { [weak self] in
            Task { @MainActor in
                guard let self, self.privacyTimers[id]?.token == token else { return }
                self.privacyTimers.removeValue(forKey: id)?.task.cancel()
            }
        }
        let task = Task { @MainActor [weak self] in
            defer {
                if backgroundID != .invalid {
                    UIApplication.shared.endBackgroundTask(backgroundID)
                }
            }
            do {
                let milliseconds = UInt64(clamping: delayMs)
                let product = milliseconds.multipliedReportingOverflow(by: 1_000_000)
                try await Task.sleep(nanoseconds: product.overflow ? UInt64.max : product.partialValue)
            } catch {
                return
            }
            await self?.completePrivacyWindow(id: id, deadline: deadline)
        }
        privacyTimers[id] = (deadline, token, task)
    }

    private func completePrivacyWindow(id: String, deadline: Int64) async {
        do {
            guard !privacySuppressedIDs.contains(id) else { return }
            let currentTime = nowMs()
            if currentTime < deadline {
                schedulePrivacyTimer(
                    id: id,
                    deadline: deadline,
                    delayMs: max(1, deadline - currentTime)
                )
                return
            }
            let now = try await nextMutationTimestamp(forIDs: [id])
            let changed = try await db.query("""
                UPDATE transcripts
                SET privacy_state = 'eligible', privacy_deadline_at_ms = NULL,
                    updated_at_ms = CASE WHEN action_protocol = 1 THEN ? ELSE updated_at_ms END,
                    dirty = CASE WHEN action_protocol = 1 THEN 1 ELSE dirty END,
                    upload_claim_token = NULL
                WHERE id = ? AND privacy_state = 'holding' AND privacy_deadline_at_ms = ?
                  AND (action_protocol = 1 OR upload_claim_token IS NULL)
                RETURNING id
                """, [.int(now), .text(id), .int(deadline)])
            privacyTimers[id] = nil
            await reload()
            if !changed.isEmpty { onLocalChange?() }
        } catch {
            privacyTimers[id] = nil
            report("This recording remains blocked because its privacy window could not be completed.", error: error)
        }
    }

    private func segmentsJSON(_ segments: [TranscriptSegment]?) -> SQLValue {
        guard let segments, !segments.isEmpty,
              let data = try? JSONEncoder().encode(segments),
              let json = String(data: data, encoding: .utf8) else { return .null }
        return .text(json)
    }

    /// Device wall clocks can repeat or move backward. Every mutation clock
    /// must still advance for its affected row so the cloud version and dirty
    /// acknowledgement cannot mistake a new edit for an older upload.
    private func nextMutationTimestamp(
        forIDs ids: [String],
        additionalFloors: [Int64] = []
    ) async throws -> Int64 {
        var floor = additionalFloors.max() ?? 0
        if !ids.isEmpty {
            let placeholders = Array(repeating: "?", count: ids.count).joined(separator: ",")
            let rows = try await db.query(
                "SELECT MAX(updated_at_ms) AS max_updated_at_ms FROM transcripts WHERE id IN (\(placeholders))",
                ids.map(SQLValue.text)
            )
            floor = max(floor, rows.first?["max_updated_at_ms"]?.intValue ?? 0)
        }
        let successor = floor == Int64.max ? Int64.max : floor + 1
        return max(Timestamps.nowMs(), successor)
    }

    @discardableResult
    func add(text: String) async -> TranscriptItem? {
        let now = Timestamps.nowMs()
        let item = TranscriptItem(
            id: "\(now)-\(String(UUID().uuidString.prefix(8)))",
            text: text,
            createdAtMs: now,
            updatedAtMs: now,
            segments: nil,
            privacyPolicy: .awaitingOffer, actionProtocol: true
        )
        do {
            try await db.run("""
                INSERT INTO transcripts (
                    id, text, created_at_ms, updated_at_ms, segments_json, dirty,
                    privacy_state, privacy_deadline_at_ms, acknowledged_updated_at_ms,
                    cloud_exposure_updated_at_ms, upload_claim_token, action_protocol
                ) VALUES (?, ?, ?, ?, NULL, 1, 'pending', NULL, NULL, NULL, NULL, 1)
                """, [.text(item.id), .text(text), .int(now), .int(now)])
            await reload()
            onLocalChange?()
            return item
        } catch {
            report("The transcript could not be saved. Its audio remains available for recovery.", error: error)
            return nil
        }
    }

    @discardableResult
    func update(_ item: TranscriptItem, text: String) async -> Bool {
        do {
            if let segments = item.segments, segments.count > 1 {
                throw DatabaseError(message: "A stacked note must be edited one segment at a time")
            }
            let now = try await nextMutationTimestamp(
                forIDs: [item.id],
                additionalFloors: [item.updatedAtMs]
            )
            var segments = item.segments
            // Editing a single-segment stack rewrites that segment too.
            if var existing = segments, existing.count == 1 {
                existing[0].text = text
                existing[0].updatedAt = now
                segments = existing
            }
            try await db.run("""
                UPDATE transcripts
                SET text = ?, updated_at_ms = ?, segments_json = ?,
                    dirty = CASE WHEN privacy_state = 'local_only' AND action_protocol = 0 THEN 0 ELSE 1 END,
                    upload_claim_token = NULL
                WHERE id = ?
                """, [.text(text), .int(now), segmentsJSON(segments), .text(item.id)])
            await reload()
            onLocalChange?()
            return true
        } catch {
            report("Changes to this voice note could not be saved.", error: error)
            return false
        }
    }

    /// Saves an edited stack without allowing its segment identities or
    /// boundaries to drift. The Mac receiver reconstructs the same ordered
    /// stack from this metadata and uses the row's merged text as a fallback.
    @discardableResult
    func updateSegments(_ item: TranscriptItem, segments editedSegments: [TranscriptSegment]) async -> Bool {
        guard let originalSegments = item.segments,
              originalSegments.count > 1,
              editedSegments.map(\.id) == originalSegments.map(\.id) else {
            onStorageError?("Changes to this stack could not be saved because its segment boundaries changed.")
            return false
        }
        let textsChanged = zip(originalSegments, editedSegments).contains { original, edited in
            original.text != edited.text
        }
        guard textsChanged else { return true }

        do {
            let now = try await nextMutationTimestamp(
                forIDs: [item.id],
                additionalFloors: [item.updatedAtMs] + originalSegments.map(\.updatedAt)
            )
            let persistedSegments = zip(originalSegments, editedSegments).map { original, edited in
                TranscriptSegment(
                    id: original.id,
                    text: edited.text,
                    createdAt: original.createdAt,
                    updatedAt: original.text == edited.text ? original.updatedAt : now
                )
            }
            let mergedText = persistedSegments.map(\.text).joined(separator: "\n\n")
            try await db.run("""
                UPDATE transcripts
                SET text = ?, updated_at_ms = ?, segments_json = ?,
                    dirty = CASE WHEN privacy_state = 'local_only' AND action_protocol = 0 THEN 0 ELSE 1 END,
                    upload_claim_token = NULL
                WHERE id = ?
                """, [.text(mergedText), .int(now), segmentsJSON(persistedSegments), .text(item.id)])
            await reload()
            onLocalChange?()
            return true
        } catch {
            report("Changes to this stack could not be saved.", error: error)
            return false
        }
    }

    func delete(ids: [String]) async {
        do {
            let now = try await nextMutationTimestamp(forIDs: ids)
            let statements = ids.flatMap { id -> [(sql: String, params: [SQLValue])] in
                [
                    ("""
                    INSERT INTO transcript_tombstones (id, deleted_at_ms)
                    SELECT id, ? FROM transcripts
                    WHERE id = ? AND cloud_exposure_updated_at_ms IS NOT NULL
                    ON CONFLICT(id) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms
                    """, [.int(now), .text(id)]),
                    ("DELETE FROM transcripts WHERE id = ?", [.text(id)]),
                ]
            }
            try await db.transaction(statements)
            await reload()
            onLocalChange?()
        } catch {
            report("The selected voice notes could not be deleted, so they remain in your library.", error: error)
        }
    }

    /// Stacking: merge the given items into the first one, segments ordered
    /// chronologically, joined with blank lines — same as the previous app.
    @discardableResult
    func stack(ids: [String]) async -> Bool {
        let stackedItems = items.filter { ids.contains($0.id) }
        guard stackedItems.count >= 2, let target = stackedItems.first else { return false }
        if stackedItems.contains(where: {
            $0.privacyPolicy == .awaitingOffer || $0.privacyPolicy == .holding
        }) {
            onStorageError?("Finish each recording's action choice before stacking it.")
            return false
        }
        let policies = Set(stackedItems.map(\.privacyPolicy))
        guard Set(stackedItems.map(\.actionProtocol)).count == 1 else {
            onStorageError?("Older private transcripts must be explicitly sent before combining them with newer recordings.")
            return false
        }
        guard policies == [.localOnly] || policies == [.uploadEligible] else {
            onStorageError?("No action and agent-enabled recordings cannot be combined.")
            return false
        }
        do {
            var segments: [TranscriptSegment] = []
            for item in stackedItems {
                if let existing = item.segments, !existing.isEmpty {
                    segments.append(contentsOf: existing)
                } else {
                    segments.append(TranscriptSegment(id: item.id, text: item.text, createdAt: item.createdAtMs, updatedAt: item.updatedAtMs))
                }
            }
            segments.sort { $0.createdAt < $1.createdAt }
            let now = try await nextMutationTimestamp(
                forIDs: stackedItems.map(\.id),
                additionalFloors: segments.map(\.updatedAt)
            )
            let mergedText = segments.map(\.text).joined(separator: "\n\n")
            let combinedPolicy = target.privacyPolicy
            let combinedDeadline: Int64? = nil
            let combinedExposure = stackedItems.compactMap(\.cloudExposureUpdatedAtMs).max()
            let combinedDirty: Int64 = combinedPolicy == .localOnly && !target.actionProtocol ? 0 : 1

            let others = stackedItems.dropFirst().map(\.id)
            var statements: [(sql: String, params: [SQLValue])] = [
                ("""
                UPDATE transcripts
                SET text = ?, updated_at_ms = ?, segments_json = ?, dirty = ?,
                    privacy_state = ?, privacy_deadline_at_ms = ?,
                    cloud_exposure_updated_at_ms = ?, upload_claim_token = NULL
                WHERE id = ?
                """,
                 [
                    .text(mergedText), .int(now), segmentsJSON(segments), .int(combinedDirty),
                    .text(combinedPolicy.rawValue), combinedDeadline.map(SQLValue.int) ?? .null,
                    combinedExposure.map(SQLValue.int) ?? .null, .text(target.id)
                 ])
            ]
            for id in others {
                statements.append(("""
                    INSERT INTO transcript_tombstones (id, deleted_at_ms)
                    SELECT id, ? FROM transcripts
                    WHERE id = ? AND cloud_exposure_updated_at_ms IS NOT NULL
                    ON CONFLICT(id) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms
                    """, [.int(now), .text(id)]))
                statements.append(("DELETE FROM transcripts WHERE id = ?", [.text(id)]))
            }
            try await db.checkedTransaction(
                checks: stackedItems.map(Self.snapshotCheck),
                statements: statements
            )
            await reload()
            onLocalChange?()
            return true
        } catch {
            report("These voice notes could not be stacked. Each original note remains unchanged.", error: error)
            return false
        }
    }

    /// Unstack: each segment becomes a standalone transcript again. The
    /// stack row goes first — its id usually belongs to one of the segments
    /// (the original first transcription), which then reclaims it. Only
    /// tombstone the stack id if no segment takes it over, otherwise the
    /// delete would eat the row we just restored.
    @discardableResult
    func unstack(_ item: TranscriptItem) async -> Bool {
        guard let segments = item.segments, segments.count > 1 else { return false }
        guard item.privacyPolicy != .awaitingOffer, item.privacyPolicy != .holding else {
            onStorageError?("Finish this recording's action choice before separating its stack.")
            return false
        }
        do {
            let now = try await nextMutationTimestamp(
                forIDs: [item.id] + segments.map(\.id),
                additionalFloors: [item.updatedAtMs] + segments.map(\.updatedAt)
            )
            var statements: [(sql: String, params: [SQLValue])] = [
                ("DELETE FROM transcripts WHERE id = ?", [.text(item.id)])
            ]
            let segmentIds = Set(segments.map(\.id))
            if !segmentIds.contains(item.id), item.cloudExposureUpdatedAtMs != nil {
                statements.append(("""
                    INSERT INTO transcript_tombstones (id, deleted_at_ms) VALUES (?, ?)
                    ON CONFLICT(id) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms
                    """, [.text(item.id), .int(now)]))
            }

            for segment in segments {
                let isReusingStackID = segment.id == item.id
                let acknowledged = isReusingStackID ? item.acknowledgedUpdatedAtMs : nil
                let exposure = isReusingStackID ? item.cloudExposureUpdatedAtMs : nil
                let dirty: Int64 = item.privacyPolicy == .localOnly && !item.actionProtocol ? 0 : 1
                statements.append(("""
                    INSERT INTO transcripts (
                        id, text, created_at_ms, updated_at_ms, segments_json, dirty,
                        privacy_state, privacy_deadline_at_ms, acknowledged_updated_at_ms,
                        cloud_exposure_updated_at_ms, upload_claim_token, action_protocol
                    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        text = excluded.text, updated_at_ms = excluded.updated_at_ms,
                        segments_json = NULL, dirty = excluded.dirty,
                        privacy_state = excluded.privacy_state,
                        privacy_deadline_at_ms = excluded.privacy_deadline_at_ms,
                        acknowledged_updated_at_ms = excluded.acknowledged_updated_at_ms,
                        cloud_exposure_updated_at_ms = excluded.cloud_exposure_updated_at_ms,
                        action_protocol = excluded.action_protocol,
                        upload_claim_token = NULL
                    """, [
                        .text(segment.id), .text(segment.text), .int(segment.createdAt), .int(now),
                        .int(dirty), .text(item.privacyPolicy.rawValue),
                        item.privacyDeadlineAtMs.map(SQLValue.int) ?? .null,
                        acknowledged.map(SQLValue.int) ?? .null,
                        exposure.map(SQLValue.int) ?? .null,
                        .int(item.actionProtocol ? 1 : 0)
                    ]))
            }
            let childAbsenceChecks = segments
                .filter { $0.id != item.id }
                .map { segment in
                    (
                        sql: "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM transcripts WHERE id = ?)",
                        params: [SQLValue.text(segment.id)]
                    )
                }
            try await db.checkedTransaction(
                checks: [Self.snapshotCheck(item)] + childAbsenceChecks,
                statements: statements
            )
            await reload()
            onLocalChange?()
            return true
        } catch {
            report("This stack could not be separated. The original stack remains unchanged.", error: error)
            return false
        }
    }

    /// Stacking a file from Library or River: the file arrives as a segment
    /// whose text carries the filename header so downstream tools know what
    /// it is.
    @discardableResult
    func addFileSegment(fileName: String, content: String, into item: TranscriptItem?) async -> Bool {
        let text = "File: \(fileName)\n\n\(content)"
        if let item {
            do {
                let existingSegments = item.segments ?? [TranscriptSegment(id: item.id, text: item.text, createdAt: item.createdAtMs, updatedAt: item.updatedAtMs)]
                let now = try await nextMutationTimestamp(
                    forIDs: [item.id],
                    additionalFloors: [item.updatedAtMs] + existingSegments.map(\.updatedAt)
                )
                var segments = existingSegments
                segments.append(TranscriptSegment(id: "\(now)-file", text: text, createdAt: now, updatedAt: now))
                segments.sort { $0.createdAt < $1.createdAt }
                let mergedText = segments.map(\.text).joined(separator: "\n\n")
                try await db.run("""
                    UPDATE transcripts
                    SET text = ?, updated_at_ms = ?, segments_json = ?,
                        dirty = CASE WHEN privacy_state = 'local_only' AND action_protocol = 0 THEN 0 ELSE 1 END,
                        upload_claim_token = NULL
                    WHERE id = ?
                    """, [.text(mergedText), .int(now), segmentsJSON(segments), .text(item.id)])
                await reload()
                onLocalChange?()
                return true
            } catch {
                report("The file could not be added to this voice note.", error: error)
                return false
            }
        } else {
            return await add(text: text) != nil
        }
    }

    private func report(_ message: String, error: Error) {
        onStorageError?("\(message) (\(error.localizedDescription))")
    }

    private static func snapshotCheck(_ item: TranscriptItem) -> (sql: String, params: [SQLValue]) {
        (
            """
            SELECT 1 FROM transcripts
            WHERE id = ? AND updated_at_ms = ? AND privacy_state = ?
              AND privacy_deadline_at_ms IS ?
              AND acknowledged_updated_at_ms IS ?
              AND cloud_exposure_updated_at_ms IS ?
              AND upload_claim_token IS NULL
            """,
            [
                .text(item.id), .int(item.updatedAtMs), .text(item.privacyPolicy.rawValue),
                item.privacyDeadlineAtMs.map(SQLValue.int) ?? .null,
                item.acknowledgedUpdatedAtMs.map(SQLValue.int) ?? .null,
                item.cloudExposureUpdatedAtMs.map(SQLValue.int) ?? .null,
            ]
        )
    }
}
