import Foundation
import Observation

/// The local mirror of the synced library. Files live as real markdown under
/// Documents/library/<source_path> — filesystem truth, same as the Mac.
/// The SQLite index tracks every remote document's metadata (so the folder
/// picker can show everything) while only selected folders are materialized
/// on disk.
@MainActor
@Observable
final class LibraryStore {
    private let db: Database

    private(set) var folders: [LibraryFolder] = []
    private(set) var docsByFolder: [String: [LibraryDocMeta]] = [:]
    private(set) var allDocs: [LibraryDocMeta] = []

    /// Bumped whenever a local edit should schedule a push.
    var onLocalChange: (() -> Void)?

    static var libraryRoot: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("library", isDirectory: true)
    }

    init(db: Database) {
        self.db = db
    }

    func fileURL(for sourcePath: String) -> URL {
        Self.libraryRoot.appendingPathComponent(sourcePath)
    }

    // MARK: - Loading

    func reload() async {
        do {
            let rows = try await db.query("SELECT * FROM library_index ORDER BY local_updated_at_ms DESC, remote_updated_at_ms DESC")
            let docs = rows.map(Self.docFromRow)
            allDocs = docs
            var grouped: [String: [LibraryDocMeta]] = [:]
            for doc in docs {
                grouped[doc.folder, default: []].append(doc)
            }
            docsByFolder = grouped
            folders = grouped.map { name, docs in
                LibraryFolder(
                    name: name,
                    documentCount: docs.count,
                    latestUpdatedAtMs: docs.map { max($0.localUpdatedAtMs, $0.remoteUpdatedAtMs) }.max() ?? 0
                )
            }
            .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
        } catch {
            // Index unavailable; views show empty state.
        }
    }

    private static func docFromRow(_ row: [String: SQLValue]) -> LibraryDocMeta {
        LibraryDocMeta(
            clientId: row["client_id"]?.stringValue ?? "",
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

    // MARK: - Content access

    func content(of doc: LibraryDocMeta) -> String? {
        try? String(contentsOf: fileURL(for: doc.sourcePath), encoding: .utf8)
    }

    /// Atomic local write + index update; marks the doc dirty for push.
    func save(sourcePath: String, content: String) async {
        let url = fileURL(for: sourcePath)
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try content.write(to: url, atomically: true, encoding: .utf8)
            let hash = Hashing.sha256Hex(content)
            let now = Timestamps.nowMs()
            try await db.run("""
                UPDATE library_index
                SET local_hash = ?, local_updated_at_ms = ?, dirty = 1, materialized = 1
                WHERE source_path = ?
                """, [.text(hash), .int(now), .text(sourcePath)])
            await reload()
            onLocalChange?()
        } catch {
            // Persisting locally failed; nothing to push.
        }
    }

    /// Creates a new markdown file with the Mac's defaults: empty content,
    /// no frontmatter, in the chosen folder.
    @discardableResult
    func createDocument(in folder: String, title: String) async -> LibraryDocMeta? {
        let safeTitle = Self.safeFileName(title.isEmpty ? Self.defaultTitle() : title)
        var sourcePath = folder.isEmpty ? "\(safeTitle).md" : "\(folder)/\(safeTitle).md"
        var attempt = 2
        while (try? await db.query("SELECT 1 FROM library_index WHERE source_path = ?", [.text(sourcePath)]))?.isEmpty == false {
            sourcePath = folder.isEmpty ? "\(safeTitle) \(attempt).md" : "\(folder)/\(safeTitle) \(attempt).md"
            attempt += 1
        }

        let clientId = Hashing.libraryClientId(sourcePath: sourcePath)
        let now = Timestamps.nowMs()
        let content = ""
        let url = fileURL(for: sourcePath)
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try content.write(to: url, atomically: true, encoding: .utf8)
            try await db.run("""
                INSERT INTO library_index
                    (client_id, source_path, title, remote_hash, local_hash, remote_updated_at_ms, local_updated_at_ms, created_at_ms, dirty, materialized)
                VALUES (?, ?, ?, NULL, ?, 0, ?, ?, 1, 1)
                """, [
                    .text(clientId), .text(sourcePath),
                    .text((sourcePath as NSString).lastPathComponent.replacingOccurrences(of: ".md", with: "")),
                    .text(Hashing.sha256Hex(content)), .int(now), .int(now),
                ])
            await reload()
            onLocalChange?()
            return allDocs.first { $0.clientId == clientId }
        } catch {
            return nil
        }
    }

    /// Explicit user delete: the only path that creates a remote tombstone.
    func deleteDocument(_ doc: LibraryDocMeta) async {
        let now = Timestamps.nowMs()
        try? FileManager.default.removeItem(at: fileURL(for: doc.sourcePath))
        try? await db.run("DELETE FROM library_index WHERE client_id = ?", [.text(doc.clientId)])
        if doc.remoteHash != nil || !doc.dirty {
            try? await db.run("""
                INSERT INTO library_tombstones (client_id, source_path, created_at_ms, deleted_at_ms)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(client_id) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms
                """, [.text(doc.clientId), .text(doc.sourcePath), .int(doc.createdAtMs), .int(now)])
        }
        await reload()
        onLocalChange?()
    }

    static func safeFileName(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = trimmed.isEmpty ? "Untitled" : trimmed
        let invalid = CharacterSet(charactersIn: "\\/:*?\"<>|")
        let cleaned = base.components(separatedBy: invalid).joined(separator: "-")
        return String(cleaned.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).prefix(120))
    }

    static func defaultTitle() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, h.mm a"
        return formatter.string(from: Date())
    }
}
