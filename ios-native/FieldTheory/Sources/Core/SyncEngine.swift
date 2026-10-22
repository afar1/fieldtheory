import Foundation
import Observation
import Supabase
import UIKit
import Network

// MARK: - Wire types

private struct LibraryMetaRow: Decodable {
    let client_id: String
    let source_path: String?
    let title: String
    let content_hash: String?
    let client_created_at_ms: Int64?
    let deleted_at: String?
    let updated_at: String
}

private struct LibraryContentRow: Decodable {
    let client_id: String
    let content: String
    let content_hash: String?
}

private struct LibraryUpsertRow: Encodable {
    let user_id: String
    let title: String
    let content: String
    let tags: [String]
    let source_path: String
    let source_kind: String
    let content_hash: String
    let client_id: String
    let client_created_at_ms: Int64
    let deleted_at: String?
}

private struct LibraryTombstoneUpdate: Encodable {
    let title: String
    let content: String
    let tags: [String]
    let source_path: String
    let source_kind: String
    let content_hash: String
    let deleted_at: String
}

private struct TeamDocumentRow: Decodable {
    let id: String
    let kind: String
    let title: String
    let content: String
    let created_by: String
    let deleted_at: String?
    let created_at: String
    let updated_at: String
    let client_created_at_ms: Int64?
    let original_source_path: String?
    let shared_name: String?
    let author_initials: String?
    let author_callsign: String?
    let revision: Int?
}

private struct ContactRow: Decodable {
    let owner_user_id: String
    let contact_email: String?
    let contact_user_id: String?
    let status: String?
}

struct TranscriptMetadata: Encodable, Equatable {
    let source: String
    let stackSegments: [TranscriptSegment]?
    let actionPolicy: String?
    let actionProtocolVersion: Int?

    init(stackSegments: [TranscriptSegment]?, actionPolicy: String? = nil) {
        source = "ios-native"
        self.stackSegments = stackSegments?.isEmpty == false ? stackSegments : nil
        self.actionPolicy = actionPolicy
        actionProtocolVersion = actionPolicy == nil ? nil : 1
    }
}

/// The authenticated iOS Voice upload wire. The Mac receiver uses `source` to
/// distinguish phone recordings from any legacy rows, and reconstructs a stack
/// from the camelCase `stackSegments` array while retaining `text` as the merged
/// plain-text representation.
struct TranscriptUpsertRow: Encodable, Equatable {
    let user_id: String
    let text: String
    let client_id: String
    let client_created_at_ms: Int64
    let client_updated_at_ms: Int64
    let deleted_at: String?
    let metadata: TranscriptMetadata

    init(userID: String, item: TranscriptItem) {
        user_id = userID
        text = item.text
        client_id = item.id
        client_created_at_ms = item.createdAtMs
        client_updated_at_ms = item.updatedAtMs
        deleted_at = nil
        metadata = TranscriptMetadata(stackSegments: item.segments, actionPolicy: item.actionProtocol ? item.actionPolicy : nil)
    }

    private enum CodingKeys: String, CodingKey {
        case user_id
        case text
        case client_id
        case client_created_at_ms
        case client_updated_at_ms
        case deleted_at
        case metadata
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(user_id, forKey: .user_id)
        try container.encode(text, forKey: .text)
        try container.encode(client_id, forKey: .client_id)
        try container.encode(client_created_at_ms, forKey: .client_created_at_ms)
        try container.encode(client_updated_at_ms, forKey: .client_updated_at_ms)
        // An unstack may reuse a previously deleted client id. Sending an
        // explicit null reliably resurrects that row on upsert.
        try container.encodeNil(forKey: .deleted_at)
        try container.encode(metadata, forKey: .metadata)
    }
}

struct TranscriptDeleteUpdate: Encodable, Equatable {
    let client_updated_at_ms: Int64
    let deleted_at: String
}

@MainActor
protocol VoiceSyncTransport: AnyObject {
    func upsert(_ rows: [TranscriptUpsertRow]) async throws
    func softDelete(clientID: String, userID: String, deletedAtMs: Int64) async throws
    func submitFeedback(_ feedback: SupportFeedback) async throws
    func agentReceipts(ids: [String]) async throws -> [VoiceAgentReceipt]
    func deliveryEvents(ids: [String]) async throws -> [VoiceDeliveryEvent]
    func runnerPresence() async throws -> [VoiceRunnerPresence]
    func runnerEvents() async throws -> [VoiceRunnerEvent]
}

struct VoiceAgentReceipt: Decodable {
    let transcript_id: String
    let revision: String
    let thread_id: String?
    let turn_id: String?
    let status: String
    var summary: String? = nil
    var final_response: String? = nil
    var hasUsableResult: Bool { !(final_response?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) }

    var confirmed: Bool {
        guard let thread_id, !thread_id.isEmpty else { return false }
        return status == "completed" || !(turn_id?.isEmpty ?? true)
    }
}

extension VoiceSyncTransport {
    func submitFeedback(_ feedback: SupportFeedback) async throws {
        throw DatabaseError(message: "Feedback delivery is unavailable.")
    }
    func agentReceipts(ids: [String]) async throws -> [VoiceAgentReceipt] { [] }
    func deliveryEvents(ids: [String]) async throws -> [VoiceDeliveryEvent] { [] }
    func runnerPresence() async throws -> [VoiceRunnerPresence] { [] }
    func runnerEvents() async throws -> [VoiceRunnerEvent] { [] }
}

@MainActor
private final class SupabaseVoiceSyncTransport: VoiceSyncTransport {
    private let client: SupabaseClient

    init(client: SupabaseClient) {
        self.client = client
    }

    func submitFeedback(_ feedback: SupportFeedback) async throws {
        try await client.from("support_feedback")
            .upsert(feedback, onConflict: "user_id,transcript_client_id,revision", ignoreDuplicates: true)
            .execute()
    }

    func upsert(_ rows: [TranscriptUpsertRow]) async throws {
        guard !rows.isEmpty else { return }
        if rows.contains(where: { $0.metadata.actionPolicy != nil }) {
            let version: Int = try await client.rpc("voice_action_protocol_version").execute().value
            guard version >= 1 else {
                throw DatabaseError(message: "Cloud saving is waiting for the No action safeguard. Transcripts remain saved on this device.")
            }
        }
        try await client
            .from("transcripts")
            .upsert(rows, onConflict: "user_id,client_id")
            .execute()
    }

    func agentReceipts(ids: [String]) async throws -> [VoiceAgentReceipt] {
        guard !ids.isEmpty else { return [] }
        var result: [VoiceAgentReceipt] = []
        for start in stride(from: 0, to: ids.count, by: 100) {
            let batch = Array(ids[start..<min(start + 100, ids.count)])
            let rows: [VoiceAgentReceipt] = try await client.from("voice_jobs")
                .select("transcript_id,revision,thread_id,status,summary,turn_id:result->>turn_id,final_response:result->>final_response")
                .in("transcript_id", values: batch)
                .order("received_at", ascending: true)
                .limit(1000)
                .execute().value
            result.append(contentsOf: rows)
        }
        return result
    }

    func deliveryEvents(ids: [String]) async throws -> [VoiceDeliveryEvent] {
        try await client.from("voice_delivery_events").select().in("transcript_id", values: ids)
            .order("occurred_at", ascending: false).limit(2000).execute().value
    }
    func runnerPresence() async throws -> [VoiceRunnerPresence] {
        try await client.from("voice_runner_presence").select().order("last_seen_at", ascending: false).limit(10).execute().value
    }
    func runnerEvents() async throws -> [VoiceRunnerEvent] {
        try await client.from("voice_runner_events").select().neq("event", value: "heartbeat")
            .order("occurred_at", ascending: false).limit(100).execute().value
    }

    func softDelete(clientID: String, userID: String, deletedAtMs: Int64) async throws {
        let update = TranscriptDeleteUpdate(
            client_updated_at_ms: deletedAtMs,
            deleted_at: Timestamps.iso(fromMs: deletedAtMs)
        )
        try await client
            .from("transcripts")
            .update(update)
            .eq("user_id", value: userID)
            .eq("client_id", value: clientID)
            .or("client_updated_at_ms.is.null,client_updated_at_ms.lte.\(deletedAtMs)")
            .execute()
    }
}

@MainActor
protocol VoiceSyncBackgroundTaskManaging: AnyObject {
    func begin(expirationHandler: @escaping () -> Void) -> UIBackgroundTaskIdentifier
    func end(_ identifier: UIBackgroundTaskIdentifier)
}

@MainActor
private final class ApplicationVoiceSyncBackgroundTasks: VoiceSyncBackgroundTaskManaging {
    func begin(expirationHandler: @escaping () -> Void) -> UIBackgroundTaskIdentifier {
        UIApplication.shared.beginBackgroundTask(
            withName: "Upload Voice recordings",
            expirationHandler: expirationHandler
        )
    }

    func end(_ identifier: UIBackgroundTaskIdentifier) {
        UIApplication.shared.endBackgroundTask(identifier)
    }
}

// MARK: - Engine

enum SyncStatus: Equatable {
    case idle
    case syncing
    case error(String)
}

/// An account-bound cancellation fence checked after every remote await and
/// before subsequent local mutations. It is kept separate from transport code
/// so the account-switch invariant can be tested without making network calls.
@MainActor
final class SyncSessionFence {
    struct Lease: Equatable {
        let generation: UInt64
        let userId: String
    }

    private var generation: UInt64 = 0
    private var userId: String?

    func activate(userId: String) -> Lease {
        generation &+= 1
        self.userId = userId
        return Lease(generation: generation, userId: userId)
    }

    func invalidate() {
        generation &+= 1
        userId = nil
    }

    func currentLease() -> Lease? {
        guard let userId else { return nil }
        return Lease(generation: generation, userId: userId)
    }

    func isActive(_ lease: Lease) -> Bool {
        generation == lease.generation && userId == lease.userId
    }

    func requireActive(_ lease: Lease) throws {
        try Task.checkCancellation()
        guard isActive(lease) else { throw CancellationError() }
    }
}

/// Speaks the exact sync dialects of the Mac app (library_documents,
/// team_documents) and the previous mobile app (transcripts). The cardinal
/// rule for this partial replica: absence is not deletion — only explicit
/// user deletes ever tombstone a remote row.
@MainActor
@Observable
final class SyncEngine {
    private static let clockSkewMs: Int64 = 1000

    private let client: SupabaseClient
    private let db: Database
    private let settings: AppSettings
    private let library: LibraryStore
    private let river: RiverStore
    let wordSubstitutions = WordSubstitutionSettings()
    private(set) var wordSubstitutionSyncError: String?
    private let transcripts: TranscriptStore
    private let voiceTransport: VoiceSyncTransport
    private let backgroundTasks: VoiceSyncBackgroundTaskManaging
    private let retryDelaySeconds: Double
    private let wordSubstitutionRequest: ([WordSubstitutionChange]) async throws -> [WordSubstitution]

    private(set) var status: SyncStatus = .idle
    private(set) var lastSyncAt: Date?

    private var pathMonitor: NWPathMonitor?
    private var connectivityGeneration = UUID()
    private var wasConnected = true
    private var deliveryChannel: RealtimeChannelV2?
    private var deliveryWatchTask: Task<Void, Never>?
    private var deliveryWatchToken: UUID?
    private var foreground = true
    private var timer: Timer?
    private var debounceTask: Task<Void, Never>?
    private var debounceGeneration: UInt64 = 0
    private var syncTask: Task<Void, Never>?
    private var syncTaskToken: UUID?
    private var backgroundTaskID: UIBackgroundTaskIdentifier?
    private var syncRequested = false
    private let sessionFence = SyncSessionFence()
    private var userId: String?
    private var userEmail: String?

    init(client: SupabaseClient, db: Database, settings: AppSettings,
         library: LibraryStore, river: RiverStore, transcripts: TranscriptStore,
         wordSubstitutionRequest: (([WordSubstitutionChange]) async throws -> [WordSubstitution])? = nil,
         voiceTransport: VoiceSyncTransport? = nil,
         backgroundTasks: VoiceSyncBackgroundTaskManaging? = nil,
         retryDelaySeconds: Double = 10) {
        self.client = client
        self.db = db
        self.settings = settings
        self.library = library
        self.river = river
        self.transcripts = transcripts
        self.voiceTransport = voiceTransport ?? SupabaseVoiceSyncTransport(client: client)
        self.backgroundTasks = backgroundTasks ?? ApplicationVoiceSyncBackgroundTasks()
        self.retryDelaySeconds = retryDelaySeconds
        self.wordSubstitutionRequest = wordSubstitutionRequest ?? { changes in
            struct Parameters: Encodable { let changes: [WordSubstitutionChange] }
            return try await client.rpc("sync_word_substitutions",
                params: Parameters(changes: changes)).execute().value
        }

        // Starting immediately acquires finite background time before a user locks
        // the phone after ending a recording.
        transcripts.onLocalChange = { [weak self] in self?.scheduleDebounced(after: 0) }
        wordSubstitutions.onChange = { [weak self] in self?.scheduleDebounced() }
    }

    func start(userId: UUID, email: String?) async {
        await stopAndWait()
        let normalizedUserID = userId.uuidString.lowercased()
        foreground = UIApplication.shared.applicationState != .background
        wordSubstitutions.selectUser(normalizedUserID)
        self.userId = normalizedUserID
        self.userEmail = email?.lowercased()
        sessionFence.activate(userId: normalizedUserID)
        if foreground { river.start(client: client, userID: normalizedUserID) }
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard self?.foreground == true else { return }
                self?.startDeliveryWatch()
                await self?.syncNow()
            }
        }
        let monitor = NWPathMonitor()
        // start() already retries. Only a later unavailable -> available
        // transition needs an extra pass; the initial path must not duplicate it.
        let generation = connectivityGeneration
        monitor.pathUpdateHandler = { [weak self] path in
            let connected = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard let self, self.connectivityGeneration == generation else { return }
                self.networkPathChanged(isConnected: connected)
            }
        }
        pathMonitor = monitor
        monitor.start(queue: DispatchQueue(label: "com.afar1.fieldtheory.connectivity"))
        startDeliveryWatch()
        scheduleDebounced(after: 0)
    }

    func setForeground(_ active: Bool) {
        foreground = active
        if active {
            if let userId { river.start(client: client, userID: userId) }
            startDeliveryWatch()
            scheduleDebounced(after: 0.3)
        } else {
            river.stop()
            deliveryWatchToken = nil
            deliveryWatchTask?.cancel()
            deliveryWatchTask = nil
            if let channel = deliveryChannel {
                deliveryChannel = nil
                Task { await client.removeChannel(channel) }
            }
        }
    }

    private func startDeliveryWatch() {
        guard foreground, deliveryWatchTask == nil, let lease = sessionFence.currentLease() else { return }
        let channel = client.channel("voice-jobs:\(lease.userId)") { $0.isPrivate = true }
        deliveryChannel = channel
        let updates = channel.broadcastStream(event: "voice_delivery_changed")
        let token = UUID()
        deliveryWatchToken = token
        deliveryWatchTask = Task { [weak self] in
            defer {
                if let self, self.deliveryWatchToken == token {
                    self.deliveryWatchTask = nil
                    self.deliveryWatchToken = nil
                    self.deliveryChannel = nil
                    Task { await self.client.removeChannel(channel) }
                }
            }
            do {
                try await channel.subscribeWithError()
                guard let self, self.isActive(lease), self.foreground else { return }
                self.scheduleDebounced(after: 0.3)
                for await _ in updates {
                    guard self.isActive(lease), self.foreground else { return }
                    self.scheduleDebounced(after: 0.3)
                }
            } catch { /* The bounded sync timer supplies catch-up while open. */ }
        }
    }

    func refreshDeliveryItem(_ id: String) async {
        guard let lease = sessionFence.currentLease() else { return }
        try? await refreshDelivery(lease: lease, selectedID: id)
    }

    private func refreshDelivery(lease: SyncSessionFence.Lease, selectedID: String? = nil) async throws {
        let ids = selectedID.map { [$0] } ?? Array(transcripts.items.prefix(200).map(\.id))
        guard !ids.isEmpty else { return }
        let receipts = (try? await voiceTransport.agentReceipts(ids: ids)) ?? transcripts.deliveryReceipts.filter { ids.contains($0.transcript_id) }
        try requireActive(lease)
        try await transcripts.recordAgentReceipts(receipts)
        let events = try? await voiceTransport.deliveryEvents(ids: ids)
        try requireActive(lease)
        let presence = try? await voiceTransport.runnerPresence()
        try requireActive(lease)
        let runnerEvents = try? await voiceTransport.runnerEvents()
        try requireActive(lease)
        transcripts.updateDelivery(receipts: receipts, events: events, presence: presence, runnerEvents: runnerEvents, replacingIDs: Set(ids))
    }

    func networkPathChanged(isConnected: Bool) {
        let restored = isConnected && !wasConnected
        wasConnected = isConnected
        guard restored, userId != nil else { return }
        scheduleDebounced(after: 0)
    }

    func queueFeedback(item: TranscriptItem) async throws {
        guard let lease = sessionFence.currentLease() else {
            throw DatabaseError(message: "Sign in to submit feedback.")
        }
        try requireActive(lease)
        try await db.enqueueFeedback(SupportFeedback(item: item, userID: lease.userId))
        try requireActive(lease)
        await transcripts.reload()
        scheduleDebounced(after: 0)
    }

    /// Invalidates the current account first, then waits for any request that
    /// was already in flight to observe cancellation and finish. Callers can
    /// safely wipe or replace the local store once this returns.
    func stopAndWait() async {
        await river.stopAndWait()
        setForeground(false)
        transcripts.clearDelivery()
        connectivityGeneration = UUID()
        wasConnected = true
        pathMonitor?.cancel()
        pathMonitor = nil
        sessionFence.invalidate()
        timer?.invalidate()
        timer = nil
        let pendingDebounce = debounceTask
        debounceGeneration &+= 1
        pendingDebounce?.cancel()
        debounceTask = nil
        syncRequested = false
        userId = nil
        userEmail = nil
        let running = syncTask
        let runningToken = syncTaskToken
        running?.cancel()
        await pendingDebounce?.value
        await running?.value
        if syncTaskToken == runningToken {
            syncTask = nil
            syncTaskToken = nil
        }
        endBackgroundTask()
        status = .idle
    }

    func scheduleDebounced(after seconds: Double = 2.0) {
        debounceGeneration &+= 1
        let generation = debounceGeneration
        debounceTask?.cancel()
        if seconds <= 0 {
            beginBackgroundTaskIfNeeded()
        }
        debounceTask = Task { [weak self] in
            if seconds > 0 {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            }
            guard !Task.isCancelled else { return }
            guard let self else { return }
            guard self.debounceGeneration == generation else { return }
            // Clear the slot before entering syncNow. A local edit or retry
            // scheduled during an in-flight request must not cancel this task,
            // which owns the loop that drains the follow-up request.
            self.debounceTask = nil
            self.beginBackgroundTaskIfNeeded()
            await self.syncNow()
        }
    }

    func syncNow() async {
        syncRequested = true
        if let syncTask {
            await syncTask.value
            return
        }
        guard userId != nil, sessionFence.currentLease() != nil else {
            syncRequested = false
            endBackgroundTask()
            return
        }

        beginBackgroundTaskIfNeeded()
        while syncRequested, let lease = sessionFence.currentLease() {
            syncRequested = false
            let taskToken = UUID()
            let task = Task { @MainActor [weak self] in
                guard let self else { return }
                await self.performSync(lease: lease)
            }
            syncTask = task
            syncTaskToken = taskToken
            await task.value
            // Clear the completed task even when it was canceled. Session
            // validity controls whether another pass may start; parent task
            // cancellation must never leave a completed task stuck here.
            if syncTaskToken == taskToken {
                syncTask = nil
                syncTaskToken = nil
            }
            if !sessionFence.isActive(lease) {
                break
            }
        }
        endBackgroundTask()
    }

    private func performSync(lease: SyncSessionFence.Lease) async {
        guard isActive(lease) else { return }
        status = .syncing
        var uploadError: Error?

        do {
            try await syncTranscripts(lease: lease)
        } catch is CancellationError {
            return
        } catch {
            uploadError = error
        }

        do {
            try await refreshDelivery(lease: lease)
        } catch is CancellationError {
            return
        } catch {
            // Delivery history is independent of the upload result.
        }

        do {
            // Support delivery is independent of transcript/agent availability.
            let feedback = try await db.pendingFeedback(userID: lease.userId)
            for row in feedback {
                try requireActive(lease)
                try await voiceTransport.submitFeedback(row)
                try requireActive(lease)
                try await db.run("UPDATE support_feedback_outbox SET sent = 1 WHERE id = ? AND user_id = ?", [.text(row.id), .text(lease.userId)])
            }
            if !feedback.isEmpty { await transcripts.reload() }
            if feedback.count == 50 { syncRequested = true }
        } catch is CancellationError {
            return
        } catch {
            if uploadError == nil { uploadError = error }
        }
        do {
            try requireActive(lease)
            try await syncWordSubstitutions(userId: lease.userId)
            try requireActive(lease)
            wordSubstitutionSyncError = nil
        } catch is CancellationError {
            return
        } catch {
            wordSubstitutionSyncError = "Saved on this iPhone. Sync unavailable; will retry."
        }
        guard isActive(lease) else { return }
        if let uploadError {
            status = .error("voice: \(uploadError.localizedDescription)")
            // SQLite dirty rows and tombstones remain the durable queue. Retry
            // soon while the app is active; start() and the timer also retry.
            scheduleDebounced(after: retryDelaySeconds)
        } else {
            lastSyncAt = Date()
            status = .idle
        }
    }

    private func beginBackgroundTaskIfNeeded() {
        guard backgroundTaskID == nil else { return }
        backgroundTaskID = backgroundTasks.begin { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.debounceTask?.cancel()
                self.syncTask?.cancel()
                self.syncRequested = false
                self.status = .error("voice: Upload paused when background time expired; it will retry automatically.")
                self.endBackgroundTask()
                self.scheduleDebounced(after: self.retryDelaySeconds)
            }
        }
    }

    private func endBackgroundTask() {
        guard let backgroundTaskID else { return }
        self.backgroundTaskID = nil
        backgroundTasks.end(backgroundTaskID)
    }

    private func isActive(_ lease: SyncSessionFence.Lease) -> Bool {
        !Task.isCancelled && sessionFence.isActive(lease)
    }

    private func requireActive(_ lease: SyncSessionFence.Lease) throws {
        try sessionFence.requireActive(lease)
    }

    // MARK: - Library

    private func syncWordSubstitutions(userId: String) async throws {
        let revision = wordSubstitutions.revision
        let pairs = try await wordSubstitutionRequest(wordSubstitutions.changes())
        guard !Task.isCancelled, self.userId == userId else { return }
        wordSubstitutions.accept(pairs, userId: userId, revision: revision)
    }

    private func normalizeSourcePath(_ sourcePath: String?, title: String) -> String? {
        LibraryPaths.normalize(sourcePath, title: title)
    }

    private func folderOf(_ sourcePath: String) -> String {
        guard let slash = sourcePath.firstIndex(of: "/") else { return "" }
        return String(sourcePath[..<slash])
    }

    private func isFolderSelected(_ folder: String) -> Bool {
        guard let selected = settings.syncedFolders else { return true }
        return selected.contains(folder)
    }

    private func syncLibrary(lease: SyncSessionFence.Lease) async throws {
        let userId = lease.userId
        try requireActive(lease)
        // 1. Pull metadata for every row (content excluded; paginated past
        // PostgREST's 1000-row cap).
        let metaRows: [LibraryMetaRow] = try await fetchAllPages { from, to in
            try await self.client
                .from("library_documents")
                .select("client_id, source_path, title, content_hash, client_created_at_ms, deleted_at, updated_at")
                .eq("user_id", value: userId)
                .order("client_id", ascending: true)
                .range(from: from, to: to)
                .execute()
                .value
        }
        try requireActive(lease)

        var index: [String: LibraryDocMeta] = [:]
        for row in try await db.query("SELECT * FROM library_index") {
            guard let clientId = row["client_id"]?.stringValue else { continue }
            index[clientId] = LibraryDocMeta(
                clientId: clientId,
                sourcePath: row["source_path"]?.stringValue ?? "",
                title: row["title"]?.stringValue ?? "",
                remoteHash: row["remote_hash"]?.stringValue,
                localHash: row["local_hash"]?.stringValue,
                remoteUpdatedAtMs: row["remote_updated_at_ms"]?.intValue ?? 0,
                localUpdatedAtMs: row["local_updated_at_ms"]?.intValue ?? 0,
                createdAtMs: row["created_at_ms"]?.intValue ?? 0,
                dirty: (row["dirty"]?.intValue ?? 0) != 0,
                materialized: (row["materialized"]?.intValue ?? 0) != 0
            )
        }
        var indexBySourcePath = Dictionary(index.values.map { ($0.sourcePath, $0) }, uniquingKeysWith: { a, _ in a })

        // 2. Apply remote tombstones (delete local unless a dirty local edit is newer).
        for row in metaRows where row.deleted_at != nil {
            let deletedAtMs = Timestamps.ms(fromISO: row.deleted_at)
            guard let local = index[row.client_id] else { continue }
            if local.dirty && local.localUpdatedAtMs > deletedAtMs + Self.clockSkewMs { continue }
            let localURL = library.fileURL(for: local.sourcePath)
            if FileManager.default.fileExists(atPath: localURL.path) {
                try FileManager.default.removeItem(at: localURL)
            }
            try await db.run("DELETE FROM library_index WHERE client_id = ?", [.text(row.client_id)])
            index[row.client_id] = nil
            indexBySourcePath[local.sourcePath] = nil
        }

        // 3. Reconcile index metadata for active rows, adopting remote client ids.
        var activeRows: [(row: LibraryMetaRow, sourcePath: String)] = []
        for row in metaRows where row.deleted_at == nil {
            guard let sourcePath = normalizeSourcePath(row.source_path, title: row.title) else { continue }
            activeRows.append((row, sourcePath))

            if let existing = indexBySourcePath[sourcePath], existing.clientId != row.client_id {
                // Same path, different id (we derived ours locally before first
                // sync) — adopt the remote id, like the Mac does.
                try await db.run("UPDATE library_index SET client_id = ? WHERE client_id = ?", [.text(row.client_id), .text(existing.clientId)])
                var adopted = existing
                adopted.clientId = row.client_id
                index[existing.clientId] = nil
                index[row.client_id] = adopted
                indexBySourcePath[sourcePath] = adopted
            }

            if index[row.client_id] == nil {
                try await db.run("""
                    INSERT INTO library_index
                        (client_id, source_path, title, remote_hash, local_hash, remote_updated_at_ms, local_updated_at_ms, created_at_ms, dirty, materialized)
                    VALUES (?, ?, ?, NULL, NULL, ?, 0, ?, 0, 0)
                    ON CONFLICT(client_id) DO NOTHING
                    """, [
                        .text(row.client_id), .text(sourcePath),
                        .text((sourcePath as NSString).lastPathComponent.replacingOccurrences(of: ".md", with: "")),
                        .int(Timestamps.ms(fromISO: row.updated_at)),
                        .int(row.client_created_at_ms ?? Timestamps.ms(fromISO: row.updated_at)),
                    ])
                let inserted = try await db.query("SELECT * FROM library_index WHERE client_id = ?", [.text(row.client_id)])
                if let r = inserted.first, let cid = r["client_id"]?.stringValue {
                    let meta = LibraryDocMeta(
                        clientId: cid, sourcePath: sourcePath,
                        title: r["title"]?.stringValue ?? "",
                        remoteHash: nil, localHash: nil,
                        remoteUpdatedAtMs: r["remote_updated_at_ms"]?.intValue ?? 0,
                        localUpdatedAtMs: 0,
                        createdAtMs: r["created_at_ms"]?.intValue ?? 0,
                        dirty: false, materialized: false
                    )
                    index[cid] = meta
                    indexBySourcePath[sourcePath] = meta
                }
            }
        }

        // 4. Materialize content for selected folders where the remote changed.
        var fetchIds: [String] = []
        for (row, sourcePath) in activeRows {
            guard isFolderSelected(folderOf(sourcePath)), let local = index[row.client_id] else { continue }
            let remoteHash = row.content_hash ?? ""
            let fileExists = FileManager.default.fileExists(atPath: library.fileURL(for: sourcePath).path)
            if !local.materialized || !fileExists || local.remoteHash != remoteHash {
                fetchIds.append(row.client_id)
            }
        }

        for chunk in fetchIds.chunked(into: 50) {
            try requireActive(lease)
            let contentRows: [LibraryContentRow] = try await client
                .from("library_documents")
                .select("client_id, content, content_hash")
                .eq("user_id", value: userId)
                .in("client_id", values: chunk)
                .execute()
                .value
            try requireActive(lease)

            for contentRow in contentRows {
                guard let local = index[contentRow.client_id] else { continue }
                let remoteHash = contentRow.content_hash ?? Hashing.sha256Hex(contentRow.content)
                let url = library.fileURL(for: local.sourcePath)
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)

                if local.dirty, local.remoteHash == remoteHash {
                    // Remote unchanged since our base; our push below wins.
                    continue
                }
                if local.dirty,
                   let localContent = try? String(contentsOf: url, encoding: .utf8),
                   Hashing.sha256Hex(localContent) != remoteHash {
                    // Local words differ from what's about to land (remote
                    // changed under us, or we never had a base): keep them in
                    // a conflict copy, take remote as canonical — Mac behavior.
                    let conflictURL = url.deletingPathExtension()
                        .appendingPathExtension("sync-conflict-\(Timestamps.nowMs()).md")
                    try localContent.write(to: conflictURL, atomically: true, encoding: .utf8)
                }

                try contentRow.content.write(to: url, atomically: true, encoding: .utf8)
                try await db.run("""
                    UPDATE library_index
                    SET remote_hash = ?, local_hash = ?, remote_updated_at_ms = ?, local_updated_at_ms = ?, dirty = 0, materialized = 1
                    WHERE client_id = ?
                    """, [
                        .text(remoteHash), .text(remoteHash),
                        .int(Timestamps.nowMs()), .int(Timestamps.nowMs()),
                        .text(contentRow.client_id),
                    ])
                index[contentRow.client_id]?.dirty = false
                index[contentRow.client_id]?.remoteHash = remoteHash
            }
        }

        // 5. Dematerialize folders the user has unselected (never dirty ones).
        if settings.syncedFolders != nil {
            for meta in index.values where meta.materialized && !meta.dirty && !isFolderSelected(meta.folder) {
                let localURL = library.fileURL(for: meta.sourcePath)
                if FileManager.default.fileExists(atPath: localURL.path) {
                    try FileManager.default.removeItem(at: localURL)
                }
                try await db.run("UPDATE library_index SET materialized = 0 WHERE client_id = ?", [.text(meta.clientId)])
            }
        }

        // 6. Push explicit local deletes as tombstones.
        let tombstones = try await db.query("SELECT * FROM library_tombstones")
        for tombstone in tombstones {
            try requireActive(lease)
            guard let clientId = tombstone["client_id"]?.stringValue,
                  let sourcePath = tombstone["source_path"]?.stringValue,
                  let deletedAtMs = tombstone["deleted_at_ms"]?.intValue else { continue }
            try await client
                .from("library_documents")
                .update(LibraryTombstoneUpdate(
                    title: "", content: "", tags: [],
                    source_path: sourcePath, source_kind: "mobile",
                    content_hash: "", deleted_at: Timestamps.iso(fromMs: deletedAtMs)
                ))
                .eq("user_id", value: userId)
                .eq("client_id", value: clientId)
                .is("deleted_at", value: nil)
                .execute()
            try requireActive(lease)
            try await db.run("DELETE FROM library_tombstones WHERE client_id = ?", [.text(clientId)])
        }

        // 7. Push dirty documents whose remote base is unchanged.
        let remoteByClientId = Dictionary(metaRows.map { ($0.client_id, $0) }, uniquingKeysWith: { a, _ in a })
        var upserts: [LibraryUpsertRow] = []
        var pushedIds: [String] = []
        for meta in index.values where meta.dirty && meta.materialized {
            if let remote = remoteByClientId[meta.clientId], remote.deleted_at == nil {
                let remoteHash = remote.content_hash ?? ""
                if let base = meta.remoteHash, base != remoteHash { continue } // conflict handled next pull
            }
            let content: String
            do {
                content = try String(contentsOf: library.fileURL(for: meta.sourcePath), encoding: .utf8)
            } catch {
                throw DatabaseError(message: "Could not read \(meta.sourcePath) for sync: \(error.localizedDescription)")
            }
            let hash = Hashing.sha256Hex(content)
            upserts.append(LibraryUpsertRow(
                user_id: userId,
                title: meta.fileName.replacingOccurrences(of: ".md", with: ""),
                content: content,
                tags: [],
                source_path: meta.sourcePath,
                source_kind: "mobile",
                content_hash: hash,
                client_id: meta.clientId,
                client_created_at_ms: meta.createdAtMs,
                deleted_at: nil
            ))
            pushedIds.append(meta.clientId)
        }
        if !upserts.isEmpty {
            try requireActive(lease)
            try await client
                .from("library_documents")
                .upsert(upserts, onConflict: "user_id,client_id")
                .execute()
            try requireActive(lease)
            for (id, row) in zip(pushedIds, upserts) {
                try await db.run("""
                    UPDATE library_index SET dirty = 0, remote_hash = ?, local_hash = ? WHERE client_id = ?
                    """, [.text(row.content_hash), .text(row.content_hash), .text(id)])
            }
        }
    }

    // MARK: - River

    private func resolveTeamScope(lease: SyncSessionFence.Lease) async throws -> String? {
        let userId = lease.userId
        try requireActive(lease)
        if let cached = try await db.getMeta("river_team_scope") {
            return cached.isEmpty ? nil : cached
        }
        var orFilter = "owner_user_id.eq.\(userId),contact_user_id.eq.\(userId)"
        if let email = userEmail, !email.isEmpty {
            orFilter += ",contact_email.eq.\(email)"
        }
        let rows: [ContactRow] = try await client
            .from("contacts")
            .select("owner_user_id, contact_email, contact_user_id, status")
            .eq("relationship_type", value: "team")
            .or(orFilter)
            .execute()
            .value
        try requireActive(lease)

        var scopes = Set<String>()
        var pendingIncoming = Set<String>()
        for row in rows {
            let isOwner = row.owner_user_id == userId
            let isContact = row.contact_user_id == userId
                || (row.contact_email?.lowercased() == userEmail && userEmail != nil)
            if row.status == "accepted" {
                if isOwner { scopes.insert(userId) } else if isContact { scopes.insert(row.owner_user_id) }
            } else if row.status == "pending", !isOwner, isContact {
                pendingIncoming.insert(row.owner_user_id)
            }
        }
        let scope: String?
        if scopes.count == 1 {
            scope = scopes.first
        } else if scopes.isEmpty, pendingIncoming.count == 1 {
            scope = pendingIncoming.first
        } else {
            scope = nil
        }
        try await db.setMeta("river_team_scope", scope ?? "")
        return scope
    }

    private func syncRiver(lease: SyncSessionFence.Lease) async throws {
        guard let scope = try await resolveTeamScope(lease: lease) else { return }

        let rows: [TeamDocumentRow] = try await fetchAllPages { from, to in
            try await self.client
                .from("team_documents")
                .select("id, kind, title, content, created_by, deleted_at, created_at, updated_at, client_created_at_ms, original_source_path, shared_name, author_initials, author_callsign, revision")
                .eq("team_scope_user_id", value: scope)
                .is("deleted_at", value: nil)
                .order("updated_at", ascending: false)
                .range(from: from, to: to)
                .execute()
                .value
        }
        try requireActive(lease)

        try await db.run("DELETE FROM river_items")
        for row in rows {
            let title = row.shared_name?.trimmingCharacters(in: .whitespaces).isEmpty == false
                ? row.shared_name!
                : (row.title.trimmingCharacters(in: .whitespaces).isEmpty ? "Untitled" : row.title)
            try await db.run("""
                INSERT INTO river_items
                    (id, title, content, author_callsign, author_initials, kind, original_source_path, revision, created_by, created_at_ms, updated_at_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [
                    .text(row.id),
                    .text(title),
                    .text(row.content),
                    row.author_callsign.map(SQLValue.text) ?? .null,
                    row.author_initials.map(SQLValue.text) ?? .null,
                    .text(row.kind),
                    row.original_source_path.map(SQLValue.text) ?? .null,
                    .int(Int64(row.revision ?? 0)),
                    .text(row.created_by),
                    .int(row.client_created_at_ms ?? Timestamps.ms(fromISO: row.created_at)),
                    .int(Timestamps.ms(fromISO: row.updated_at)),
                ])
        }
        // Forget read state for items that no longer exist.
        try await db.run("DELETE FROM river_read_state WHERE id NOT IN (SELECT id FROM river_items)")
    }

    /// Re-resolve team scope on demand (e.g. pull-to-refresh after joining a team).
    func refreshTeamScope() async {
        try? await db.setMeta("river_team_scope", nil)
        await syncNow()
    }

    /// Shares a library document to River, matching the Mac's shareFile:
    /// client_id = "shared-" + sha256("<user>:<sourceKey>")[0..<32], path
    /// under Docs/, revision 1, upsert on (team_scope_user_id, client_id).
    func shareToRiver(sourcePath: String, content: String) async -> Bool {
        guard let userId else { return false }
        guard let lease = sessionFence.currentLease() else { return false }
        do {
            guard let scope = try await resolveTeamScope(lease: lease) else { return false }

            struct ProfileRow: Decodable { let callsign: String? }
            let callsign: String? = await {
                let row: ProfileRow? = try? await client
                    .from("profiles")
                    .select("callsign")
                    .eq("id", value: userId)
                    .single()
                    .execute()
                    .value
                return row?.callsign?.trimmingCharacters(in: .whitespaces)
            }()
            try requireActive(lease)

            let initials: String = {
                let source = userEmail ?? "FT"
                let words = source.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
                if words.count >= 2, let a = words[0].first, let b = words[1].first {
                    return String([a, b]).uppercased()
                }
                return String((words.first ?? "FT").prefix(2)).uppercased()
            }()

            let title = (sourcePath as NSString).lastPathComponent
                .replacingOccurrences(of: ".md", with: "")
            let now = Timestamps.nowMs()

            struct TeamDocUpsert: Encodable {
                let team_scope_user_id: String
                let kind: String
                let path: String
                let title: String
                let content: String
                let content_hash: String
                let client_id: String
                let client_created_at_ms: Int64
                let created_by: String
                let updated_by: String
                let deleted_at: String?
                let original_source_path: String
                let shared_name: String
                let author_initials: String
                let author_callsign: String?
                let revision: Int
            }

            try await client
                .from("team_documents")
                .upsert(TeamDocUpsert(
                    team_scope_user_id: scope,
                    kind: "document",
                    path: "Docs/\(sourcePath)",
                    title: title,
                    content: content,
                    content_hash: Hashing.sha256Hex(content),
                    client_id: "shared-" + String(Hashing.sha256Hex("\(userId):\(sourcePath)").prefix(32)),
                    client_created_at_ms: now,
                    created_by: userId,
                    updated_by: userId,
                    deleted_at: nil,
                    original_source_path: sourcePath,
                    shared_name: title,
                    author_initials: initials,
                    author_callsign: callsign?.isEmpty == false ? callsign : nil,
                    revision: 1
                ), onConflict: "team_scope_user_id,client_id")
                .execute()
            try requireActive(lease)

            scheduleDebounced(after: 0.5)
            return true
        } catch {
            return false
        }
    }

    // MARK: - Transcripts (Voice)

    private func syncTranscripts(lease: SyncSessionFence.Lease) async throws {
        let userId = lease.userId
        try requireActive(lease)
        // Phone deletions stay as soft-delete mutations so the Mac receiver can
        // reconcile an item it previously imported. Each local tombstone is
        // removed only if the exact uploaded version still exists afterward.
        let tombstones = try await db.query(
            "SELECT id, deleted_at_ms FROM transcript_tombstones ORDER BY deleted_at_ms ASC"
        )
        for tombstone in tombstones {
            try requireActive(lease)
            guard let id = tombstone["id"]?.stringValue,
                  let deletedAtMs = tombstone["deleted_at_ms"]?.intValue else { continue }
            try await voiceTransport.softDelete(
                clientID: id,
                userID: userId,
                deletedAtMs: deletedAtMs
            )
            try requireActive(lease)
            try await db.run(
                "DELETE FROM transcript_tombstones WHERE id = ? AND deleted_at_ms = ?",
                [.text(id), .int(deletedAtMs)]
            )
        }

        // Claim eligible revisions before constructing the wire payload. The
        // persisted cloud-exposure clock is deliberately advanced before the
        // request: a transport error is ambiguous and a later explicit delete
        // must conservatively remove a row that may have reached the server.
        let claimToken = UUID().uuidString
        try await db.transaction([
            ("""
            UPDATE transcripts SET upload_claim_token = NULL
            WHERE upload_claim_token IS NOT NULL
            """, []),
            ("""
            UPDATE transcripts
            SET upload_claim_token = ?,
                cloud_exposure_updated_at_ms = CASE
                    WHEN cloud_exposure_updated_at_ms IS NULL
                      OR cloud_exposure_updated_at_ms < updated_at_ms
                    THEN updated_at_ms ELSE cloud_exposure_updated_at_ms END
            WHERE dirty != 0 AND (action_protocol = 1 OR (privacy_state = 'eligible'
              AND privacy_deadline_at_ms IS NULL))
              AND upload_claim_token IS NULL
            """, [.text(claimToken)])
        ])

        // Upload-only by construction: this query reads only revisions owned
        // by this claim. There is no remote SELECT or remote-to-local mutation.
        var snapshots: [TranscriptItem] = []
        do {
            for row in try await db.query("""
                SELECT id, text, created_at_ms, updated_at_ms, segments_json,
                       privacy_state, privacy_deadline_at_ms,
                       acknowledged_updated_at_ms, cloud_exposure_updated_at_ms, action_protocol
                FROM transcripts
                WHERE upload_claim_token = ? AND dirty != 0
                  AND (action_protocol = 1 OR (privacy_state = 'eligible' AND privacy_deadline_at_ms IS NULL))
                ORDER BY updated_at_ms ASC
                """, [.text(claimToken)]) {
                guard let id = row["id"]?.stringValue else { continue }
                var segments: [TranscriptSegment]?
                if let json = row["segments_json"]?.stringValue,
                   let data = json.data(using: .utf8) {
                    segments = try JSONDecoder().decode([TranscriptSegment].self, from: data)
                }
                snapshots.append(TranscriptItem(
                    id: id,
                    text: row["text"]?.stringValue ?? "",
                    createdAtMs: row["created_at_ms"]?.intValue ?? 0,
                    updatedAtMs: row["updated_at_ms"]?.intValue ?? 0,
                    segments: segments,
                    privacyPolicy: TranscriptPrivacyPolicy(rawValue: row["privacy_state"]?.stringValue ?? "eligible") ?? .awaitingOffer,
                    privacyDeadlineAtMs: row["privacy_deadline_at_ms"]?.intValue,
                    acknowledgedUpdatedAtMs: row["acknowledged_updated_at_ms"]?.intValue,
                    cloudExposureUpdatedAtMs: row["cloud_exposure_updated_at_ms"]?.intValue,
                    actionProtocol: row["action_protocol"]?.intValue == 1
                ))
            }
        } catch {
            try? await db.run(
                "UPDATE transcripts SET upload_claim_token = NULL WHERE upload_claim_token = ?",
                [.text(claimToken)]
            )
            throw error
        }

        let upserts = snapshots.map { TranscriptUpsertRow(userID: userId, item: $0) }
        if !upserts.isEmpty {
            do {
                try requireActive(lease)
                try await voiceTransport.upsert(upserts)
                try requireActive(lease)
                for item in snapshots {
                    // A local edit or policy change while the request is in
                    // flight clears the claim and cannot be acknowledged by
                    // this older server response.
                    try await db.run("""
                        UPDATE transcripts
                        SET dirty = 0, acknowledged_updated_at_ms = ?,
                            upload_claim_token = NULL
                        WHERE id = ? AND updated_at_ms = ?
                          AND upload_claim_token = ?
                          AND (action_protocol = 1 OR (privacy_state = 'eligible'
                          AND privacy_deadline_at_ms IS NULL))
                        """, [
                            .int(item.updatedAtMs), .text(item.id),
                            .int(item.updatedAtMs), .text(claimToken)
                        ])
                }
                await transcripts.reload()
            } catch {
                try? await db.run(
                    "UPDATE transcripts SET upload_claim_token = NULL WHERE upload_claim_token = ?",
                    [.text(claimToken)]
                )
                throw error
            }
        } else {
            try await db.run(
                "UPDATE transcripts SET upload_claim_token = NULL WHERE upload_claim_token = ?",
                [.text(claimToken)]
            )
        }
    }

    /// PostgREST caps responses at 1000 rows; page until a short page.
    private func fetchAllPages<Row>(_ fetch: (Int, Int) async throws -> [Row]) async throws -> [Row] {
        let pageSize = 1000
        var all: [Row] = []
        var from = 0
        while true {
            try Task.checkCancellation()
            let page = try await fetch(from, from + pageSize - 1)
            try Task.checkCancellation()
            all.append(contentsOf: page)
            if page.count < pageSize { break }
            from += pageSize
        }
        return all
    }
}

extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
