import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

@MainActor
final class SQLiteClipboardStore: ClipboardStore {
    let supportsDelete: Bool

    private let paths: DataPaths
    private var db: OpaquePointer?

    init(
        paths: DataPaths = .default(),
        safetyManager: DataSafetyManager = DataSafetyManager()
    ) throws {
        self.paths = paths
        self.supportsDelete = safetyManager.canDeleteFromNativeStore()

        try safetyManager.ensureSafeFilesystemLayout()
        try openDatabase()
        try initializeSchema()
        try seedFromLegacyIfNativeIsEmpty(limit: 300)
    }

    func fetchRecent(limit: Int) -> [ClipboardItem] {
        guard let db else { return [] }

        let sql = """
        SELECT id, type, content, created_at, source, stack_id, word_count
        FROM clipboard_items
        ORDER BY created_at DESC
        LIMIT ?;
        """

        var statement: OpaquePointer?
        defer { sqlite3_finalize(statement) }

        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            return []
        }

        sqlite3_bind_int(statement, 1, Int32(limit))

        var result: [ClipboardItem] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            let id = sqlite3_column_int64(statement, 0)
            let typeText = text(from: statement, column: 1) ?? ClipboardItemType.text.rawValue
            let content = text(from: statement, column: 2)
            let createdAtMs = sqlite3_column_int64(statement, 3)
            let sourceText = text(from: statement, column: 4) ?? ClipboardSource.mac.rawValue
            let stackID = text(from: statement, column: 5)
            let wordCount: Int? = sqlite3_column_type(statement, 6) == SQLITE_NULL
                ? nil
                : Int(sqlite3_column_int(statement, 6))

            let item = ClipboardItem(
                id: id,
                type: ClipboardItemType(rawValue: typeText) ?? .text,
                content: content,
                createdAt: Date(timeIntervalSince1970: TimeInterval(createdAtMs) / 1000.0),
                source: ClipboardSource(rawValue: sourceText) ?? .mac,
                stackID: stackID,
                wordCount: wordCount
            )
            result.append(item)
        }

        return result
    }

    func insert(_ item: ClipboardItem) {
        guard let db else { return }

        let sql = """
        INSERT INTO clipboard_items (
            id,
            type,
            content,
            created_at,
            source,
            stack_id,
            word_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?);
        """

        var statement: OpaquePointer?
        defer { sqlite3_finalize(statement) }

        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            return
        }

        sqlite3_bind_int64(statement, 1, item.id)
        sqlite3_bind_text(statement, 2, item.type.rawValue, -1, SQLITE_TRANSIENT)
        bindOptionalText(item.content, to: statement, index: 3)
        sqlite3_bind_int64(statement, 4, Int64(item.createdAt.timeIntervalSince1970 * 1000))
        sqlite3_bind_text(statement, 5, item.source.rawValue, -1, SQLITE_TRANSIENT)
        bindOptionalText(item.stackID, to: statement, index: 6)
        if let wordCount = item.wordCount {
            sqlite3_bind_int(statement, 7, Int32(wordCount))
        } else {
            sqlite3_bind_null(statement, 7)
        }

        sqlite3_step(statement)
    }

    func delete(id: Int64) {
        guard supportsDelete else { return }
        guard let db else { return }

        var statement: OpaquePointer?
        defer { sqlite3_finalize(statement) }

        let sql = "DELETE FROM clipboard_items WHERE id = ?;"
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            return
        }

        sqlite3_bind_int64(statement, 1, id)
        sqlite3_step(statement)
    }

    private func openDatabase() throws {
        let path = paths.nativeDatabaseURL.path
        let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        let code = sqlite3_open_v2(path, &db, flags, nil)
        guard code == SQLITE_OK else {
            let message = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "Unknown SQLite open error"
            throw NSError(domain: "SQLiteClipboardStore", code: Int(code), userInfo: [NSLocalizedDescriptionKey: message])
        }
    }

    private func initializeSchema() throws {
        guard let db else { return }

        try execSQL(
            """
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            CREATE TABLE IF NOT EXISTS native_migrations (
                version INTEGER PRIMARY KEY,
                description TEXT NOT NULL,
                applied_at INTEGER NOT NULL
            );
            """,
            on: db
        )

        try runMigration(version: 1, description: "create clipboard_items table", db: db) {
            try self.execSQL(
                """
                CREATE TABLE IF NOT EXISTS clipboard_items (
                    id INTEGER PRIMARY KEY,
                    type TEXT NOT NULL,
                    content TEXT,
                    created_at INTEGER NOT NULL,
                    source TEXT NOT NULL DEFAULT 'mac',
                    stack_id TEXT,
                    word_count INTEGER
                );
                """,
                on: db
            )
        }

        try runMigration(version: 2, description: "add clipboard_items indexes", db: db) {
            try self.execSQL(
                """
                CREATE INDEX IF NOT EXISTS idx_clipboard_items_created_at
                    ON clipboard_items(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_clipboard_items_type
                    ON clipboard_items(type);
                CREATE INDEX IF NOT EXISTS idx_clipboard_items_source
                    ON clipboard_items(source);
                """,
                on: db
            )
        }
    }

    private func seedFromLegacyIfNativeIsEmpty(limit: Int) throws {
        guard let db else { return }
        guard tableCount(in: db) == 0 else { return }

        let candidateRoots: [URL]
        if let primaryLegacyRoot = paths.primaryLegacyRoot {
            candidateRoots = [primaryLegacyRoot] + paths.legacyRoots.filter { $0 != primaryLegacyRoot }
        } else {
            candidateRoots = paths.legacyRoots
        }

        var legacyDB: OpaquePointer?

        for root in candidateRoots {
            let legacyPath = root.appendingPathComponent("clipboard.db", isDirectory: false)
            guard FileManager.default.fileExists(atPath: legacyPath.path) else { continue }

            var candidateDB: OpaquePointer?
            let openCode = sqlite3_open_v2(
                legacyPath.path,
                &candidateDB,
                SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX,
                nil
            )
            guard openCode == SQLITE_OK, let candidateDB else { continue }

            let hasTable = sqliteHasTable(candidateDB, tableName: "clipboard_items")
            if hasTable {
                legacyDB = candidateDB
                break
            }

            sqlite3_close(candidateDB)
        }

        guard let legacyDB else { return }
        defer {
            sqlite3_close(legacyDB)
        }

        let seedSQL = """
        SELECT id, type, content, created_at, source, stack_id, word_count
        FROM clipboard_items
        ORDER BY created_at DESC
        LIMIT ?;
        """

        var statement: OpaquePointer?
        defer { sqlite3_finalize(statement) }

        guard sqlite3_prepare_v2(legacyDB, seedSQL, -1, &statement, nil) == SQLITE_OK else { return }
        sqlite3_bind_int(statement, 1, Int32(limit))

        while sqlite3_step(statement) == SQLITE_ROW {
            let item = ClipboardItem(
                id: sqlite3_column_int64(statement, 0),
                type: ClipboardItemType(rawValue: text(from: statement, column: 1) ?? "text") ?? .text,
                content: text(from: statement, column: 2),
                createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(statement, 3)) / 1000.0),
                source: ClipboardSource(rawValue: text(from: statement, column: 4) ?? "mac") ?? .mac,
                stackID: text(from: statement, column: 5),
                wordCount: sqlite3_column_type(statement, 6) == SQLITE_NULL ? nil : Int(sqlite3_column_int(statement, 6))
            )
            insert(item)
        }
    }

    private func sqliteHasTable(_ db: OpaquePointer, tableName: String) -> Bool {
        let sql = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1;"
        var statement: OpaquePointer?
        defer { sqlite3_finalize(statement) }

        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return false }
        sqlite3_bind_text(statement, 1, tableName, -1, SQLITE_TRANSIENT)
        return sqlite3_step(statement) == SQLITE_ROW
    }

    private func tableCount(in db: OpaquePointer) -> Int {
        let sql = "SELECT COUNT(*) FROM clipboard_items;"
        var statement: OpaquePointer?
        defer { sqlite3_finalize(statement) }

        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return 0 }
        guard sqlite3_step(statement) == SQLITE_ROW else { return 0 }
        return Int(sqlite3_column_int(statement, 0))
    }

    private func text(from statement: OpaquePointer?, column: Int32) -> String? {
        guard let cString = sqlite3_column_text(statement, column) else { return nil }
        return String(cString: cString)
    }

    private func bindOptionalText(_ value: String?, to statement: OpaquePointer?, index: Int32) {
        if let value {
            sqlite3_bind_text(statement, index, value, -1, SQLITE_TRANSIENT)
        } else {
            sqlite3_bind_null(statement, index)
        }
    }

    private func execSQL(_ sql: String, on db: OpaquePointer) throws {
        let code = sqlite3_exec(db, sql, nil, nil, nil)
        guard code == SQLITE_OK else {
            let message = String(cString: sqlite3_errmsg(db))
            throw NSError(domain: "SQLiteClipboardStore", code: Int(code), userInfo: [NSLocalizedDescriptionKey: message])
        }
    }

    private func runMigration(
        version: Int,
        description: String,
        db: OpaquePointer,
        block: () throws -> Void
    ) throws {
        let existsSQL = "SELECT 1 FROM native_migrations WHERE version = ? LIMIT 1;"
        var existsStatement: OpaquePointer?
        defer { sqlite3_finalize(existsStatement) }

        guard sqlite3_prepare_v2(db, existsSQL, -1, &existsStatement, nil) == SQLITE_OK else {
            throw NSError(domain: "SQLiteClipboardStore", code: Int(sqlite3_errcode(db)), userInfo: nil)
        }
        sqlite3_bind_int(existsStatement, 1, Int32(version))
        if sqlite3_step(existsStatement) == SQLITE_ROW {
            return
        }

        try block()

        let insertSQL = """
        INSERT INTO native_migrations (version, description, applied_at)
        VALUES (?, ?, ?);
        """
        var insertStatement: OpaquePointer?
        defer { sqlite3_finalize(insertStatement) }

        guard sqlite3_prepare_v2(db, insertSQL, -1, &insertStatement, nil) == SQLITE_OK else {
            throw NSError(domain: "SQLiteClipboardStore", code: Int(sqlite3_errcode(db)), userInfo: nil)
        }
        sqlite3_bind_int(insertStatement, 1, Int32(version))
        sqlite3_bind_text(insertStatement, 2, description, -1, SQLITE_TRANSIENT)
        sqlite3_bind_int64(insertStatement, 3, Int64(Date().timeIntervalSince1970 * 1000))

        guard sqlite3_step(insertStatement) == SQLITE_DONE else {
            throw NSError(domain: "SQLiteClipboardStore", code: Int(sqlite3_errcode(db)), userInfo: nil)
        }
    }
}
