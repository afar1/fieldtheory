import Foundation
import Observation

/// Local cache of team_documents plus on-device read state. Read state is
/// keyed by (id, revision) so an item that gets updated upstream surfaces as
/// unread again.
@MainActor
@Observable
final class RiverStore {
    private let db: Database

    private(set) var items: [RiverItem] = []
    private(set) var readState: [String: Int] = [:] // id -> read_revision
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
            items = rows.map { row in
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
            let stateRows = try await db.query("SELECT id, read_revision FROM river_read_state")
            readState = Dictionary(uniqueKeysWithValues: stateRows.compactMap { row in
                guard let id = row["id"]?.stringValue else { return nil }
                return (id, Int(row["read_revision"]?.intValue ?? 0))
            })
            // nil = not resolved yet (stay hopeful); "" = resolved, no team.
            let scope = try await db.getMeta("river_team_scope")
            available = scope != ""
        } catch {
            items = []
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
