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

struct DatabaseError: Error, LocalizedError {
    let message: String

    var errorDescription: String? { message }
}

/// Minimal SQLite wrapper. All access is serialized through the actor.
actor Database {
    private var db: OpaquePointer?

    /// Opens the durable store when possible and falls back to an in-memory
    /// store so a filesystem failure never crashes the app at launch. The
    /// caller receives the durable-store error and can present a recovery UI.
    nonisolated static func recovering(path: String) -> (database: Database, error: Error?) {
        do {
            return (try Database(path: path), nil)
        } catch {
            // SQLite's in-memory database avoids touching the failed path. If
            // this extremely small fallback cannot open, retain an unavailable
            // actor whose operations report the original failure.
            return (Database(unavailableBecause: error), error)
        }
    }

    init(path: String) throws {
        if path != ":memory:" {
            try FileManager.default.createDirectory(
                at: URL(fileURLWithPath: path).deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
        }
        var handle: OpaquePointer?
        guard sqlite3_open(path, &handle) == SQLITE_OK, let handle else {
            if let handle { sqlite3_close(handle) }
            throw DatabaseError(message: "Could not open database at \(path)")
        }
        db = handle
        sqlite3_exec(handle, "PRAGMA journal_mode=WAL;", nil, nil, nil)
        sqlite3_exec(handle, "PRAGMA foreign_keys=ON;", nil, nil, nil)
        do {
            try migrateSync()
        } catch {
            sqlite3_close(handle)
            db = nil
            throw error
        }
    }

    private init(unavailableBecause originalError: Error) {
        var handle: OpaquePointer?
        if sqlite3_open(":memory:", &handle) == SQLITE_OK, let handle {
            db = handle
            sqlite3_exec(handle, "PRAGMA foreign_keys=ON;", nil, nil, nil)
            try? migrateSync()
        } else {
            db = nil
        }
    }

    deinit {
        if let db { sqlite3_close(db) }
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
        CREATE TABLE IF NOT EXISTS river_blocked_authors (
            author_id TEXT PRIMARY KEY,
            author_label TEXT NOT NULL DEFAULT '',
            blocked_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS transcripts (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            segments_json TEXT,
            dirty INTEGER NOT NULL DEFAULT 0,
            privacy_state TEXT NOT NULL DEFAULT 'pending',
            privacy_deadline_at_ms INTEGER,
            acknowledged_updated_at_ms INTEGER,
            cloud_exposure_updated_at_ms INTEGER,
            upload_claim_token TEXT
        );
        CREATE TABLE IF NOT EXISTS transcript_tombstones (
            id TEXT PRIMARY KEY,
            deleted_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS support_feedback_outbox (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            transcript_id TEXT NOT NULL,
            revision TEXT NOT NULL,
            payload TEXT NOT NULL,
            sent INTEGER NOT NULL DEFAULT 0,
            UNIQUE(user_id, transcript_id, revision)
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

        _ = try ensureColumn(table: "transcripts", name: "action_protocol", definition: "INTEGER NOT NULL DEFAULT 0")
        _ = try ensureColumn(table: "transcripts", name: "agent_sent_revision", definition: "TEXT")
        _ = try ensureColumn(table: "transcripts", name: "agent_status", definition: "TEXT")
        _ = try ensureColumn(table: "transcripts", name: "agent_status_revision", definition: "TEXT")

        // Existing Voice databases predate the per-recording privacy hold.
        // Clean rows are known cloud history. Dirty legacy rows retain their
        // retry behavior and are treated as possibly dispatched by an older build.
        let addedPrivacyState = try ensureColumn(
            table: "transcripts", name: "privacy_state",
            definition: "TEXT NOT NULL DEFAULT 'eligible'"
        )
        _ = try ensureColumn(
            table: "transcripts", name: "privacy_deadline_at_ms",
            definition: "INTEGER"
        )
        _ = try ensureColumn(
            table: "transcripts", name: "acknowledged_updated_at_ms",
            definition: "INTEGER"
        )
        _ = try ensureColumn(
            table: "transcripts", name: "cloud_exposure_updated_at_ms",
            definition: "INTEGER"
        )
        _ = try ensureColumn(
            table: "transcripts", name: "upload_claim_token",
            definition: "TEXT"
        )
        guard sqlite3_exec(
            db,
            """
            UPDATE transcripts
            SET acknowledged_updated_at_ms = updated_at_ms
            WHERE dirty = 0
              AND privacy_state = 'eligible'
              AND acknowledged_updated_at_ms IS NULL;
            UPDATE transcripts
            SET cloud_exposure_updated_at_ms = acknowledged_updated_at_ms
            WHERE cloud_exposure_updated_at_ms IS NULL
              AND acknowledged_updated_at_ms IS NOT NULL;
            CREATE INDEX IF NOT EXISTS transcripts_privacy_queue
            ON transcripts(privacy_state, dirty, privacy_deadline_at_ms, updated_at_ms);
            """,
            nil, nil, nil
        ) == SQLITE_OK else {
            throw DatabaseError(message: lastErrorMessage())
        }
        if addedPrivacyState {
            guard sqlite3_exec(
                db,
                """
                UPDATE transcripts
                SET privacy_state = 'eligible', privacy_deadline_at_ms = NULL,
                    upload_claim_token = NULL,
                    cloud_exposure_updated_at_ms = COALESCE(
                        cloud_exposure_updated_at_ms, updated_at_ms
                    )
                WHERE dirty != 0;
                """,
                nil, nil, nil
            ) == SQLITE_OK else {
                throw DatabaseError(message: lastErrorMessage())
            }
        }
    }

    @discardableResult
    private func ensureColumn(table: String, name: String, definition: String) throws -> Bool {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "PRAGMA table_info(\(table))", -1, &statement, nil) == SQLITE_OK else {
            throw DatabaseError(message: lastErrorMessage())
        }
        defer { sqlite3_finalize(statement) }
        var exists = false
        while sqlite3_step(statement) == SQLITE_ROW {
            guard let columnName = sqlite3_column_text(statement, 1) else { continue }
            if String(cString: columnName) == name {
                exists = true
                break
            }
        }
        guard !exists else { return false }
        guard sqlite3_exec(
            db, "ALTER TABLE \(table) ADD COLUMN \(name) \(definition)", nil, nil, nil
        ) == SQLITE_OK else {
            throw DatabaseError(message: lastErrorMessage())
        }
        return true
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
        guard db != nil else { throw DatabaseError(message: "Local storage is unavailable") }
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
        guard db != nil else { throw DatabaseError(message: "Local storage is unavailable") }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            throw DatabaseError(message: "\(lastErrorMessage()) — \(sql)")
        }
        defer { sqlite3_finalize(statement) }
        bind(statement, params)

        var rows: [[String: SQLValue]] = []
        let columnCount = sqlite3_column_count(statement)
        while true {
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { break }
            guard result == SQLITE_ROW else {
                throw DatabaseError(message: "\(lastErrorMessage()) — \(sql)")
            }
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

    /// Runs related local mutations as one unit. A failure rolls every
    /// statement back so transcript stacks and tombstones cannot be half-saved.
    func transaction(_ statements: [(sql: String, params: [SQLValue])]) throws {
        try run("BEGIN IMMEDIATE")
        do {
            for statement in statements {
                try run(statement.sql, statement.params)
            }
            try run("COMMIT")
        } catch {
            try? run("ROLLBACK")
            throw error
        }
    }

    /// Runs mutations only if every read snapshot still matches inside the
    /// same SQLite transaction. This prevents an awaited UI operation from
    /// overwriting a newer privacy choice or upload claim.
    func checkedTransaction(
        checks: [(sql: String, params: [SQLValue])],
        statements: [(sql: String, params: [SQLValue])]
    ) throws {
        try run("BEGIN IMMEDIATE")
        do {
            for check in checks {
                guard try !query(check.sql, check.params).isEmpty else {
                    throw DatabaseError(message: "The voice note changed before the operation could finish")
                }
            }
            for statement in statements {
                try run(statement.sql, statement.params)
            }
            try run("COMMIT")
        } catch {
            try? run("ROLLBACK")
            throw error
        }
    }

    /// Claims the local replica for one account. A legacy, unclaimed store is
    /// adopted by the currently persisted identity. A different owner is
    /// cleared atomically before the new owner becomes visible.
    @discardableResult
    func activate(ownerID: String) throws -> Bool {
        let previousOwner = try getMeta("storage_owner_user_id")
        guard previousOwner != ownerID else { return false }

        if previousOwner == nil {
            try setMeta("storage_owner_user_id", ownerID)
            return false
        }

        try run("BEGIN IMMEDIATE")
        do {
            try resetContents(includeOwner: true)
            try setMeta("storage_owner_user_id", ownerID)
            // Files and queued audio live outside SQLite. Keep this marker in
            // the same transaction so a crash or filesystem failure retries
            // external cleanup before the new account is enabled.
            try setMeta("storage_external_cleanup_required", "1")
            try run("COMMIT")
            return true
        } catch {
            try? run("ROLLBACK")
            throw error
        }
    }

    func externalCleanupRequired() throws -> Bool {
        try getMeta("storage_external_cleanup_required") == "1"
    }

    func markExternalCleanupComplete() throws {
        try setMeta("storage_external_cleanup_required", nil)
    }

    /// Wipes all user-scoped data; used on sign-out.
    func reset() throws {
        try run("BEGIN IMMEDIATE")
        do {
            try resetContents(includeOwner: true)
            try run("COMMIT")
        } catch {
            try? run("ROLLBACK")
            throw error
        }
    }

    private func resetContents(includeOwner: Bool) throws {
        var tables = ["library_index", "library_tombstones", "river_items", "river_read_state", "river_blocked_authors", "transcripts", "transcript_tombstones", "goal_feedback", "recents", "support_feedback_outbox"]
        if includeOwner { tables.append("meta") }
        for table in tables {
            try run("DELETE FROM \(table)")
        }
    }
}
