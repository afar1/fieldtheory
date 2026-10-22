import Foundation
import Observation
import Supabase

/// Local cache of team_documents plus on-device read state. Read state is
/// keyed by (id, revision) so an item that gets updated upstream surfaces as
/// unread again.
@MainActor
@Observable
final class RiverStore {
    private let db: Database
    private var client: SupabaseClient?
    private var owner: String?
    private var session = UUID()
    private var channel: RealtimeChannelV2?
    private var watchers: [Task<Void, Never>] = []
    private var refreshTask: Task<Void, Never>?
    private var fullRefreshPending = false
    private var pendingDocumentIDs: Set<String> = []
    private(set) var connectionError: String?

    func start(client: SupabaseClient, userID: String) {
        if owner == userID, channel != nil { return }
        stop()
        self.client = client
        owner = userID
        let token = session
        let channel = client.channel("ios-river:\(userID):\(token.uuidString)")
        self.channel = channel
        let documents = channel.postgresChange(AnyAction.self, schema: "public", table: "river_documents")
        let audience = channel.postgresChange(AnyAction.self, schema: "public", table: "river_document_audience", filter: "recipient_user_id=eq.\(userID)")
        let targets = channel.postgresChange(AnyAction.self, schema: "public", table: "river_document_targets")
        watchers.append(Task { [weak self] in
            do {
                try await channel.subscribeWithError()
                guard let self, self.session == token else { return }
            } catch {
                guard let self, self.session == token else { return }
                self.connectionError = "Live updates unavailable. Pull to refresh."
            }
        })
        for (stream, key) in [(documents, "id"), (audience, "document_id"), (targets, "document_id")] {
            watchers.append(Task { [weak self] in
                for await action in stream {
                    guard let self, self.session == token, !Task.isCancelled else { return }
                    let record: [String: AnyJSON]
                    switch action {
                    case .insert(let row): record = row.record
                    case .update(let row): record = row.record
                    case .delete(let row): record = row.oldRecord
                    }
                    if case .string(let id) = record[key] {
                        self.requestRefresh(documentIDs: [id])
                    } else { self.requestRefresh() }
                }
            })
        }
        let membership = channel.postgresChange(AnyAction.self, schema: "public", table: "river_share_group_members", filter: "member_user_id=eq.\(userID)")
        let groups = channel.postgresChange(AnyAction.self, schema: "public", table: "river_share_groups")
        for stream in [membership, groups] {
            watchers.append(Task { [weak self] in
                for await _ in stream {
                    guard let self, self.session == token, !Task.isCancelled else { return }
                    self.requestRefresh()
                }
            })
        }
        let statuses = channel.statusChange
        watchers.append(Task { [weak self] in
            for await status in statuses {
                guard let self, self.session == token, !Task.isCancelled else { return }
                if status == .subscribed { self.requestRefresh() }
            }
        })
        requestRefresh()
    }

    func stop() {
        session = UUID()
        watchers.forEach { $0.cancel() }
        watchers.removeAll()
        refreshTask?.cancel()
        refreshTask = nil
        fullRefreshPending = false
        pendingDocumentIDs.removeAll()
        if let channel, let client { Task { await client.removeChannel(channel) } }
        channel = nil
        client = nil
        owner = nil
    }

    func stopAndWait() async {
        let pending = refreshTask
        stop()
        await pending?.value
    }

    func requestRefresh(documentIDs: Set<String>? = nil) {
        guard let client, let owner else { return }
        if let documentIDs { pendingDocumentIDs.formUnion(documentIDs) }
        else { fullRefreshPending = true }
        guard refreshTask == nil else { return }
        let token = session
        refreshTask = Task { [weak self] in
            guard let self else { return }
            repeat {
                let full = self.fullRefreshPending
                let ids = self.pendingDocumentIDs
                self.fullRefreshPending = false
                self.pendingDocumentIDs.removeAll()
                do {
                    let rows = try await RiverTransport(client: client).documents(userID: owner, documentIDs: full ? nil : ids)
                    guard self.session == token, !Task.isCancelled,
                          client.auth.currentUser?.id.uuidString.lowercased() == owner else { return }
                    // Cache replacement is atomic; realtime changes replace only the affected documents.
                    var statements: [(sql: String, params: [SQLValue])] = []
                    if full { statements.append(("DELETE FROM river_items", [])) }
                    else {
                        for id in ids { statements.append(("DELETE FROM river_items WHERE id = ?", [.text(id)])) }
                    }
                    for row in rows {
                        statements.append(("""
                            INSERT INTO river_items (id,title,content,author_initials,author_callsign,kind,revision,created_by,created_at_ms,updated_at_ms)
                            VALUES (?,?,?,?,?,'document',?,?,?,?)
                            """, [.text(row.id), .text(row.title), .text(row.content), row.author_initials.map(SQLValue.text) ?? .null,
                                  row.author_callsign.map(SQLValue.text) ?? .null, .int(Int64(row.revision ?? 0)), .text(row.created_by),
                                  .int(Timestamps.ms(fromISO: row.created_at)), .int(Timestamps.ms(fromISO: row.updated_at))]))
                    }
                    try await self.db.transaction(statements)
                    guard self.session == token else { return }
                    await self.reload()
                    self.connectionError = nil
                } catch {
                    guard self.session == token, !Task.isCancelled else { return }
                    self.connectionError = "River unavailable. Pull to retry."
                }
            } while (self.fullRefreshPending || !self.pendingDocumentIDs.isEmpty) && self.session == token && !Task.isCancelled
            if self.session == token { self.refreshTask = nil }
        }
    }


    private(set) var items: [RiverItem] = []
    private(set) var readState: [String: Int] = [:] // id -> read_revision
    private(set) var blockedAuthors: [RiverBlockedAuthor] = []
    private(set) var available = true

    init(db: Database) {
        self.db = db
    }

    var unreadCount: Int {
        items.filter { isUnread($0) }.count
    }

    func isUnread(_ item: RiverItem) -> Bool {
        guard let readRevision = readState[item.id] else { return true }
        return item.revision > readRevision
    }

    func reload() async {
        do {
            let rows = try await db.query("SELECT * FROM river_items ORDER BY updated_at_ms DESC")
            let loadedItems = rows.map { row in
                let content = row["content"]?.stringValue ?? ""
                return RiverItem(
                    id: row["id"]?.stringValue ?? "",
                    title: row["title"]?.stringValue ?? "Untitled",
                    content: content,
                    authorCallsign: row["author_callsign"]?.stringValue,
                    authorInitials: row["author_initials"]?.stringValue,
                    kind: row["kind"]?.stringValue ?? "document",
                    originalSourcePath: row["original_source_path"]?.stringValue,
                    revision: Int(row["revision"]?.intValue ?? 0),
                    createdBy: row["created_by"]?.stringValue ?? "",
                    createdAtMs: row["created_at_ms"]?.intValue ?? 0,
                    updatedAtMs: row["updated_at_ms"]?.intValue ?? 0,
                    preview: Self.makePreview(content)
                )
            }
            // A staged client may briefly open an existing database before
            // the local schema migration that adds this table. Showing River
            // normally is safer than treating that migration gap as an empty
            // feed; blocking becomes available after the next reload.
            let blockedRows = (try? await db.query("""
                SELECT author_id, author_label, blocked_at_ms
                FROM river_blocked_authors
                ORDER BY blocked_at_ms DESC
                """)) ?? []
            blockedAuthors = blockedRows.compactMap { row in
                guard let authorID = row["author_id"]?.stringValue,
                      !authorID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
                return RiverBlockedAuthor(
                    authorID: authorID,
                    authorLabel: row["author_label"]?.stringValue ?? "",
                    blockedAtMs: row["blocked_at_ms"]?.intValue ?? 0
                )
            }
            let blockedIDs = Set(blockedAuthors.map(\.authorID))
            items = loadedItems.filter { item in
                guard let authorID = item.authorID else { return true }
                return !blockedIDs.contains(authorID)
            }
            let stateRows = try await db.query("SELECT id, read_revision FROM river_read_state")
            readState = Dictionary(uniqueKeysWithValues: stateRows.compactMap { row in
                guard let id = row["id"]?.stringValue else { return nil }
                return (id, Int(row["read_revision"]?.intValue ?? 0))
            })
            // nil = not resolved yet (stay hopeful); "" = resolved, no team.
            let scope = try await db.getMeta("river_team_scope")
            available = client != nil || scope != ""
        } catch {
            items = []
        }
    }

    /// Blocks this account only in the signed-in person's on-device River
    /// cache. It immediately removes the author's existing items locally;
    /// it does not delete remote content, notify the author, or submit a
    /// report to Field Theory.
    func blockAuthor(of item: RiverItem) async -> Bool {
        guard let authorID = item.authorID else { return false }
        do {
            try await db.run("""
                INSERT INTO river_blocked_authors (author_id, author_label, blocked_at_ms)
                VALUES (?, ?, ?)
                ON CONFLICT(author_id) DO UPDATE SET
                    author_label = excluded.author_label,
                    blocked_at_ms = excluded.blocked_at_ms
                """, [.text(authorID), .text(item.authorLabel), .int(Timestamps.nowMs())])
            await reload()
            return true
        } catch {
            return false
        }
    }

    func unblockAuthor(_ author: RiverBlockedAuthor) async -> Bool {
        do {
            try await db.run("DELETE FROM river_blocked_authors WHERE author_id = ?", [.text(author.authorID)])
            await reload()
            return true
        } catch {
            return false
        }
    }

    func markRead(_ item: RiverItem) async {
        try? await db.run("""
            INSERT INTO river_read_state (id, read_at_ms, read_revision)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET read_at_ms = excluded.read_at_ms, read_revision = excluded.read_revision
            """, [.text(item.id), .int(Timestamps.nowMs()), .int(Int64(item.revision))])
        readState[item.id] = item.revision
    }

    func markUnread(_ item: RiverItem) async {
        try? await db.run("DELETE FROM river_read_state WHERE id = ?", [.text(item.id)])
        readState[item.id] = nil
    }

    /// Markdown → plain preview text, done once per item at load time.
    static func makePreview(_ content: String) -> String {
        let stripped = MarkdownParser.stripFrontmatter(content)
        let lines = stripped.components(separatedBy: "\n")
            .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("#") }
            .map { line -> String in
                line.replacingOccurrences(of: "^\\s*([-*+]|\\d+\\.)\\s+(\\[[ xX]\\]\\s*)?", with: "", options: .regularExpression)
                    .replacingOccurrences(of: "[*_`>]", with: "", options: .regularExpression)
            }
        return String(lines.joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .prefix(360))
    }
}
