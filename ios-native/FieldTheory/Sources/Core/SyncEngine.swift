import Foundation
import Observation
import Supabase

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

/// The deployed transcripts table is lean: id, user_id, client_id,
/// client_created_at_ms, text, created_at, updated_at. No metadata column —
/// stack segments stay local; the merged text is what syncs. No deleted_at —
/// deletes are hard DELETEs.
private struct TranscriptRow: Decodable {
    let client_id: String
    let text: String
    let client_created_at_ms: Int64
    let updated_at: String
}

private struct TranscriptUpsertRow: Encodable {
    let user_id: String
    let text: String
    let client_id: String
    let client_created_at_ms: Int64
    let updated_at: String
}

// MARK: - Engine

enum SyncStatus: Equatable {
    case idle
    case syncing
    case error(String)
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
    private let transcripts: TranscriptStore

    private(set) var status: SyncStatus = .idle
    private(set) var lastSyncAt: Date?

    private var timer: Timer?
    private var debounceTask: Task<Void, Never>?
    private var userId: String?
    private var userEmail: String?

    init(client: SupabaseClient, db: Database, settings: AppSettings,
         library: LibraryStore, river: RiverStore, transcripts: TranscriptStore) {
        self.client = client
        self.db = db
        self.settings = settings
        self.library = library
        self.river = river
        self.transcripts = transcripts

        library.onLocalChange = { [weak self] in self?.scheduleDebounced() }
        transcripts.onLocalChange = { [weak self] in self?.scheduleDebounced() }
    }

    func start(userId: UUID, email: String?) {
        self.userId = userId.uuidString.lowercased()
        self.userEmail = email?.lowercased()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 90, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.syncNow() }
        }
        Task { await syncNow() }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        debounceTask?.cancel()
        userId = nil
    }

    func scheduleDebounced(after seconds: Double = 2.0) {
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await self?.syncNow()
        }
    }

    func syncNow() async {
        guard let userId, status != .syncing else { return }
        status = .syncing
        var errors: [String] = []

        do { try await syncLibrary(userId: userId) } catch { errors.append("library: \(error.localizedDescription)") }
        do { try await syncRiver(userId: userId) } catch { errors.append("river: \(error.localizedDescription)") }
        do { try await syncTranscripts(userId: userId) } catch { errors.append("voice: \(error.localizedDescription)") }

        await library.reload()
        await river.reload()
        await transcripts.reload()

        lastSyncAt = Date()
        status = errors.isEmpty ? .idle : .error(errors.joined(separator: " · "))
    }

    // MARK: - Library

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

    private func syncLibrary(userId: String) async throws {
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
            try? FileManager.default.removeItem(at: library.fileURL(for: local.sourcePath))
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
            let contentRows: [LibraryContentRow] = try await client
                .from("library_documents")
                .select("client_id, content, content_hash")
                .eq("user_id", value: userId)
                .in("client_id", values: chunk)
                .execute()
                .value

            for contentRow in contentRows {
                guard let local = index[contentRow.client_id] else { continue }
                let remoteHash = contentRow.content_hash ?? Hashing.sha256Hex(contentRow.content)
                let url = library.fileURL(for: local.sourcePath)
                try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)

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
                    try? localContent.write(to: conflictURL, atomically: true, encoding: .utf8)
                }

                try? contentRow.content.write(to: url, atomically: true, encoding: .utf8)
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
                try? FileManager.default.removeItem(at: library.fileURL(for: meta.sourcePath))
                try await db.run("UPDATE library_index SET materialized = 0 WHERE client_id = ?", [.text(meta.clientId)])
            }
        }

        // 6. Push explicit local deletes as tombstones.
        let tombstones = try await db.query("SELECT * FROM library_tombstones")
        for tombstone in tombstones {
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
            guard let content = try? String(contentsOf: library.fileURL(for: meta.sourcePath), encoding: .utf8) else { continue }
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
            try await client
                .from("library_documents")
                .upsert(upserts, onConflict: "user_id,client_id")
                .execute()
            for (id, row) in zip(pushedIds, upserts) {
                try await db.run("""
                    UPDATE library_index SET dirty = 0, remote_hash = ?, local_hash = ? WHERE client_id = ?
                    """, [.text(row.content_hash), .text(row.content_hash), .text(id)])
            }
        }
    }

    // MARK: - River

    private func resolveTeamScope(userId: String) async throws -> String? {
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

    private func syncRiver(userId: String) async throws {
        guard let scope = try await resolveTeamScope(userId: userId) else { return }

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

    // MARK: - Transcripts (Voice)

    private func syncTranscripts(userId: String) async throws {
        // Push explicit deletes as hard DELETEs (no deleted_at column).
        let tombstones = try await db.query("SELECT * FROM transcript_tombstones")
        for tombstone in tombstones {
            guard let id = tombstone["id"]?.stringValue else { continue }
            try await client
                .from("transcripts")
                .delete()
                .eq("user_id", value: userId)
                .eq("client_id", value: id)
                .execute()
            try await db.run("DELETE FROM transcript_tombstones WHERE id = ?", [.text(id)])
        }

        let rows: [TranscriptRow] = try await fetchAllPages { from, to in
            try await self.client
                .from("transcripts")
                .select("client_id, text, client_created_at_ms, updated_at")
                .eq("user_id", value: userId)
                .order("created_at", ascending: false)
                .range(from: from, to: to)
                .execute()
                .value
        }

        var local: [String: TranscriptItem] = [:]
        var localDirty: Set<String> = []
        for row in try await db.query("SELECT id, text, created_at_ms, updated_at_ms, dirty FROM transcripts") {
            guard let id = row["id"]?.stringValue else { continue }
            local[id] = TranscriptItem(
                id: id,
                text: row["text"]?.stringValue ?? "",
                createdAtMs: row["created_at_ms"]?.intValue ?? 0,
                updatedAtMs: row["updated_at_ms"]?.intValue ?? 0,
                segments: nil
            )
            if (row["dirty"]?.intValue ?? 0) != 0 { localDirty.insert(id) }
        }

        let remoteIds = Set(rows.map(\.client_id))

        for row in rows {
            let remoteEditMs = Timestamps.ms(fromISO: row.updated_at)
            if let existing = local[row.client_id] {
                // Local edit wins while dirty; otherwise newer remote text lands.
                if localDirty.contains(row.client_id) { continue }
                if existing.updatedAtMs >= remoteEditMs + Self.clockSkewMs { continue }
                if existing.text == row.text { continue }
                try await db.run("""
                    UPDATE transcripts SET text = ?, updated_at_ms = ?, dirty = 0 WHERE id = ?
                    """, [.text(row.text), .int(remoteEditMs), .text(row.client_id)])
            } else {
                try await db.run("""
                    INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
                    VALUES (?, ?, ?, ?, NULL, 0)
                    """, [
                        .text(row.client_id), .text(row.text),
                        .int(row.client_created_at_ms), .int(remoteEditMs),
                    ])
            }
        }

        // A clean local item missing remotely was deleted from another device.
        for (id, _) in local where !remoteIds.contains(id) && !localDirty.contains(id) {
            try await db.run("DELETE FROM transcripts WHERE id = ?", [.text(id)])
        }

        // Push dirty items (creations, edits, stacks — merged text only).
        var upserts: [TranscriptUpsertRow] = []
        var pushed: [String] = []
        for id in localDirty {
            guard let item = local[id] else { continue }
            upserts.append(TranscriptUpsertRow(
                user_id: userId,
                text: item.text,
                client_id: item.id,
                client_created_at_ms: item.createdAtMs,
                updated_at: Timestamps.iso(fromMs: item.updatedAtMs)
            ))
            pushed.append(id)
        }
        if !upserts.isEmpty {
            try await client
                .from("transcripts")
                .upsert(upserts, onConflict: "user_id,client_id")
                .execute()
            for id in pushed {
                try await db.run("UPDATE transcripts SET dirty = 0 WHERE id = ?", [.text(id)])
            }
        }
    }

    /// PostgREST caps responses at 1000 rows; page until a short page.
    private func fetchAllPages<Row>(_ fetch: (Int, Int) async throws -> [Row]) async throws -> [Row] {
        let pageSize = 1000
        var all: [Row] = []
        var from = 0
        while true {
            let page = try await fetch(from, from + pageSize - 1)
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
