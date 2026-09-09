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

    let libraryRoot: URL

    private(set) var folders: [LibraryFolder] = []
    private(set) var docsByFolder: [String: [LibraryDocMeta]] = [:]
    private(set) var allDocs: [LibraryDocMeta] = []
    /// Recently opened (visit-based, like the Mac sidebar), capped for load cost while still scrollable.
    private(set) var recents: [LibraryDocMeta] = []

    /// Bumped whenever a local edit should schedule a push.
    var onLocalChange: (() -> Void)?
    var onStorageError: ((String) -> Void)?

    static var libraryRoot: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("library", isDirectory: true)
    }

    init(db: Database, libraryRoot: URL? = nil) {
        self.db = db
        self.libraryRoot = libraryRoot ?? Self.libraryRoot
    }

    func fileURL(for sourcePath: String) -> URL {
        libraryRoot.appendingPathComponent(sourcePath)
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

            let bySourcePath = Dictionary(docs.map { ($0.sourcePath, $0) }, uniquingKeysWith: { a, _ in a })
            let recentRows = try await db.query(
                "SELECT source_path FROM recents ORDER BY last_opened_at_ms DESC LIMIT 50"
            )
            recents = recentRows.compactMap { row in
                guard let path = row["source_path"]?.stringValue,
                      let doc = bySourcePath[path], doc.materialized else { return nil }
                return doc
            }
        } catch {
            report("Your library could not be loaded. Your files are still on this device.", error: error)
        }
    }

    /// Records that the user opened a document — the Mac's "visit" semantic.
    func recordVisit(sourcePath: String) async {
        do {
            try await db.run("""
                INSERT INTO recents (source_path, last_opened_at_ms) VALUES (?, ?)
                ON CONFLICT(source_path) DO UPDATE SET last_opened_at_ms = excluded.last_opened_at_ms
                """, [.text(sourcePath), .int(Timestamps.nowMs())])
        } catch {
            report("This recent item could not be updated.", error: error)
        }
        await reload()
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
        } catch {
            report("Your note could not be saved. Its previous version remains unchanged.", error: error)
            return
        }

        do {
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
            // Atomic file writing preserves the user's latest words even when
            // the index cannot be marked dirty. Report that sync is pending
            // instead of silently claiming the save succeeded.
            report("Your note was kept on this device, but it could not be queued for sync. Try again after checking available storage.", error: error)
        }
    }

    /// Creates a new markdown file with the Mac's defaults: empty content,
    /// no frontmatter, in the chosen folder.
    @discardableResult
    func createDocument(in folder: String, title: String) async -> LibraryDocMeta? {
        var createdURL: URL?
        do {
            let safeTitle = Self.safeFileName(title.isEmpty ? Self.defaultTitle() : title)
            var sourcePath = folder.isEmpty ? "\(safeTitle).md" : "\(folder)/\(safeTitle).md"
            var attempt = 2
            while true {
                let indexed = try await db.query("SELECT 1 FROM library_index WHERE source_path = ?", [.text(sourcePath)])
                let existsOnDisk = FileManager.default.fileExists(atPath: fileURL(for: sourcePath).path)
                if indexed.isEmpty, !existsOnDisk { break }
                sourcePath = folder.isEmpty ? "\(safeTitle) \(attempt).md" : "\(folder)/\(safeTitle) \(attempt).md"
                attempt += 1
            }

            let clientId = Hashing.libraryClientId(sourcePath: sourcePath)
            let now = Timestamps.nowMs()
            let content = ""
            let url = fileURL(for: sourcePath)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try content.write(to: url, atomically: true, encoding: .utf8)
            createdURL = url
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
            if let createdURL { try? FileManager.default.removeItem(at: createdURL) }
            report("The new note could not be saved. Try again after checking available storage.", error: error)
            return nil
        }
    }

    /// Explicit user delete: the only path that creates a remote tombstone.
    func deleteDocument(_ doc: LibraryDocMeta) async {
        let now = Timestamps.nowMs()
        var statements: [(sql: String, params: [SQLValue])] = [
            ("DELETE FROM library_index WHERE client_id = ?", [.text(doc.clientId)])
        ]
        if doc.remoteHash != nil || !doc.dirty {
            statements.append(("""
                    INSERT INTO library_tombstones (client_id, source_path, created_at_ms, deleted_at_ms)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(client_id) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms
                    """, [.text(doc.clientId), .text(doc.sourcePath), .int(doc.createdAtMs), .int(now)]))
        }
        do {
            try await db.transaction(statements)
            do {
                try FileManager.default.removeItem(at: fileURL(for: doc.sourcePath))
            } catch where (error as NSError).code != NSFileNoSuchFileError {
                report("The note was removed from your library, but its local file could not be cleaned up.", error: error)
            }
            await reload()
            onLocalChange?()
        } catch {
            report("The note could not be deleted, so it remains in your library.", error: error)
        }
    }

    private func report(_ message: String, error: Error) {
        onStorageError?("\(message) (\(error.localizedDescription))")
    }

    static func safeFileName(_ value: String) -> String {
        LibraryPaths.safeFileName(value)
    }

    static func defaultTitle() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, h.mm a"
        return formatter.string(from: Date())
    }
}
