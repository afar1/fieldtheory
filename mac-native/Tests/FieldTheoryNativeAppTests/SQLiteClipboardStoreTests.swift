import Foundation
import SQLite3
import XCTest
@testable import FieldTheoryNativeApp

final class SQLiteClipboardStoreTests: XCTestCase {
    private var tempRoot: URL!
    private var supportRoot: URL!

    override func setUpWithError() throws {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("field-theory-native-sqlite-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        tempRoot = base
        supportRoot = base.appendingPathComponent("Application Support", isDirectory: true)
        try FileManager.default.createDirectory(at: supportRoot, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let tempRoot {
            try? FileManager.default.removeItem(at: tempRoot)
        }
    }

    @MainActor
    func testStrictPolicyBlocksDelete() throws {
        let paths = DataPaths.make(supportRoot: supportRoot)
        let manager = DataSafetyManager(policy: .strict, paths: paths)
        let store = try SQLiteClipboardStore(paths: paths, safetyManager: manager)

        let item = ClipboardItem(
            id: 111,
            type: .transcript,
            content: "do not delete",
            createdAt: Date(),
            source: .mac,
            stackID: nil,
            wordCount: 3
        )

        store.insert(item)
        XCTAssertEqual(store.fetchRecent(limit: 10).count, 1)
        XCTAssertFalse(store.supportsDelete)

        store.delete(id: 111)
        XCTAssertEqual(store.fetchRecent(limit: 10).count, 1)
    }

    @MainActor
    func testNativeMigrationsTableIsPopulated() throws {
        let paths = DataPaths.make(supportRoot: supportRoot)
        let manager = DataSafetyManager(policy: .strict, paths: paths)
        _ = try SQLiteClipboardStore(paths: paths, safetyManager: manager)

        var db: OpaquePointer?
        let openCode = sqlite3_open_v2(
            paths.nativeDatabaseURL.path,
            &db,
            SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        XCTAssertEqual(openCode, SQLITE_OK)
        guard let db else {
            XCTFail("Failed to open native DB")
            return
        }
        defer { sqlite3_close(db) }

        let countSQL = "SELECT COUNT(*) FROM native_migrations;"
        var statement: OpaquePointer?
        defer { sqlite3_finalize(statement) }
        XCTAssertEqual(sqlite3_prepare_v2(db, countSQL, -1, &statement, nil), SQLITE_OK)
        XCTAssertEqual(sqlite3_step(statement), SQLITE_ROW)
        let count = Int(sqlite3_column_int(statement, 0))
        XCTAssertGreaterThanOrEqual(count, 2)
    }

    @MainActor
    func testSeedsFromLegacyClipboardDatabaseReadOnly() throws {
        let legacyRoot = supportRoot.appendingPathComponent("fieldtheory-mac", isDirectory: true)
        try FileManager.default.createDirectory(at: legacyRoot, withIntermediateDirectories: true)
        let legacyDBURL = legacyRoot.appendingPathComponent("clipboard.db", isDirectory: false)
        try createLegacyClipboardDB(at: legacyDBURL)

        let paths = DataPaths.make(supportRoot: supportRoot)
        let manager = DataSafetyManager(policy: .strict, paths: paths)
        let store = try SQLiteClipboardStore(paths: paths, safetyManager: manager)
        let items = store.fetchRecent(limit: 10)

        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].id, 42)
        XCTAssertEqual(items[0].content, "legacy transcript")
        XCTAssertEqual(items[0].type, .transcript)
    }

    private func createLegacyClipboardDB(at url: URL) throws {
        var db: OpaquePointer?
        let openCode = sqlite3_open_v2(
            url.path,
            &db,
            SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        guard openCode == SQLITE_OK, let db else {
            throw NSError(domain: "SQLiteClipboardStoreTests", code: Int(openCode))
        }

        defer {
            sqlite3_close(db)
        }

        let createSQL = """
        CREATE TABLE IF NOT EXISTS clipboard_items (
            id INTEGER PRIMARY KEY,
            type TEXT NOT NULL,
            content TEXT,
            created_at INTEGER NOT NULL,
            source TEXT DEFAULT 'mac',
            stack_id TEXT,
            word_count INTEGER
        );
        """

        guard sqlite3_exec(db, createSQL, nil, nil, nil) == SQLITE_OK else {
            throw NSError(domain: "SQLiteClipboardStoreTests", code: Int(sqlite3_errcode(db)))
        }

        let insertSQL = """
        INSERT INTO clipboard_items (id, type, content, created_at, source, stack_id, word_count)
        VALUES (42, 'transcript', 'legacy transcript', 1700000000000, 'mac', NULL, 2);
        """
        guard sqlite3_exec(db, insertSQL, nil, nil, nil) == SQLITE_OK else {
            throw NSError(domain: "SQLiteClipboardStoreTests", code: Int(sqlite3_errcode(db)))
        }
    }
}
