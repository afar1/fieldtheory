import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

enum SQLValue {
    case text(String)
    case int(Int64)
    case null

    var stringValue: String? {
        if case .text(let value) = self { return value }
        return nil
    }

    var intValue: Int64? {
        if case .int(let value) = self { return value }
        return nil
    }
}

struct DatabaseError: Error {
    let message: String
}

/// Minimal SQLite wrapper. All access is serialized through the actor.
actor Database {
    private var db: OpaquePointer?

    init(path: String) throws {
        try FileManager.default.createDirectory(
            at: URL(fileURLWithPath: path).deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        var handle: OpaquePointer?
        guard sqlite3_open(path, &handle) == SQLITE_OK, let handle else {
            throw DatabaseError(message: "Could not open database at \(path)")
        }
        db = handle
        sqlite3_exec(handle, "PRAGMA journal_mode=WAL;", nil, nil, nil)
        sqlite3_exec(handle, "PRAGMA foreign_keys=ON;", nil, nil, nil)
        try migrateSync()
    }

    private func migrateSync() throws {
        let schema = """
        CREATE TABLE IF NOT EXISTS library_index (
            client_id TEXT PRIMARY KEY,
            source_path TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            remote_hash TEXT,
            local_hash TEXT,
            remote_updated_at_ms INTEGER NOT NULL DEFAULT 0,
            local_updated_at_ms INTEGER NOT NULL DEFAULT 0,
            created_at_ms INTEGER NOT NULL DEFAULT 0,
            dirty INTEGER NOT NULL DEFAULT 0,
            materialized INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS library_tombstones (
            client_id TEXT PRIMARY KEY,
            source_path TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL DEFAULT 0,
            deleted_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS river_items (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            author_callsign TEXT,
            author_initials TEXT,
            kind TEXT NOT NULL DEFAULT 'document',
            original_source_path TEXT,
            revision INTEGER NOT NULL DEFAULT 0,
            created_by TEXT NOT NULL DEFAULT '',
            created_at_ms INTEGER NOT NULL DEFAULT 0,
            updated_at_ms INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS river_read_state (
            id TEXT PRIMARY KEY,
            read_at_ms INTEGER NOT NULL,
            read_revision INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS transcripts (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            segments_json TEXT,
            dirty INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS transcript_tombstones (
            id TEXT PRIMARY KEY,
            deleted_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS recents (
            source_path TEXT PRIMARY KEY,
            last_opened_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS goal_feedback (
            id TEXT PRIMARY KEY,
            card_id TEXT NOT NULL,
            algorithm_version TEXT NOT NULL,
            project TEXT NOT NULL,
            action TEXT NOT NULL,
            context TEXT,
            created_at_ms INTEGER NOT NULL
        );
        """
        guard sqlite3_exec(db, schema, nil, nil, nil) == SQLITE_OK else {
            throw DatabaseError(message: lastErrorMessage())
        }
    }

    private func lastErrorMessage() -> String {
        db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "unknown sqlite error"
    }

    private func bind(_ statement: OpaquePointer?, _ params: [SQLValue]) {
        for (index, param) in params.enumerated() {
            let position = Int32(index + 1)
            switch param {
            case .text(let value):
                sqlite3_bind_text(statement, position, value, -1, SQLITE_TRANSIENT)
            case .int(let value):
                sqlite3_bind_int64(statement, position, value)
            case .null:
                sqlite3_bind_null(statement, position)
            }
        }
    }

    func run(_ sql: String, _ params: [SQLValue] = []) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            throw DatabaseError(message: "\(lastErrorMessage()) — \(sql)")
        }
        defer { sqlite3_finalize(statement) }
        bind(statement, params)
        let result = sqlite3_step(statement)
        guard result == SQLITE_DONE || result == SQLITE_ROW else {
            throw DatabaseError(message: "\(lastErrorMessage()) — \(sql)")
        }
    }

    func query(_ sql: String, _ params: [SQLValue] = []) throws -> [[String: SQLValue]] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            throw DatabaseError(message: "\(lastErrorMessage()) — \(sql)")
        }
        defer { sqlite3_finalize(statement) }
        bind(statement, params)

        var rows: [[String: SQLValue]] = []
        let columnCount = sqlite3_column_count(statement)
        while sqlite3_step(statement) == SQLITE_ROW {
            var row: [String: SQLValue] = [:]
            for column in 0..<columnCount {
                let name = String(cString: sqlite3_column_name(statement, column))
                switch sqlite3_column_type(statement, column) {
                case SQLITE_INTEGER:
                    row[name] = .int(sqlite3_column_int64(statement, column))
                case SQLITE_TEXT:
                    row[name] = .text(String(cString: sqlite3_column_text(statement, column)))
                case SQLITE_NULL:
                    row[name] = .null
                case SQLITE_FLOAT:
                    row[name] = .int(Int64(sqlite3_column_double(statement, column)))
                default:
                    row[name] = .null
                }
            }
            rows.append(row)
        }
        return rows
    }

    func getMeta(_ key: String) throws -> String? {
        try query("SELECT value FROM meta WHERE key = ?", [.text(key)]).first?["value"]?.stringValue
    }

    func setMeta(_ key: String, _ value: String?) throws {
        if let value {
            try run("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [.text(key), .text(value)])
        } else {
            try run("DELETE FROM meta WHERE key = ?", [.text(key)])
        }
    }

    /// Wipes all user-scoped data; used on sign-out.
    func reset() throws {
        for table in ["library_index", "library_tombstones", "river_items", "river_read_state", "transcripts", "transcript_tombstones", "meta", "goal_feedback"] {
            try run("DELETE FROM \(table)")
        }
    }
}
