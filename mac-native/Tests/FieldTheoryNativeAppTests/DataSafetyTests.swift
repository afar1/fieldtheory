import XCTest
@testable import FieldTheoryNativeApp

final class DataSafetyTests: XCTestCase {
    private var tempRoot: URL!
    private var supportRoot: URL!

    override func setUpWithError() throws {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("field-theory-native-tests-\(UUID().uuidString)", isDirectory: true)
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
    func testDataPathsSelectPrimaryLegacyRootWithClipboardDB() throws {
        let fieldTheoryMac = supportRoot.appendingPathComponent("fieldtheory-mac", isDirectory: true)
        let littleAIMac = supportRoot.appendingPathComponent("littleai-mac", isDirectory: true)
        try FileManager.default.createDirectory(at: fieldTheoryMac, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: littleAIMac, withIntermediateDirectories: true)

        let clipboardFile = fieldTheoryMac.appendingPathComponent("clipboard.db", isDirectory: false)
        try Data("db".utf8).write(to: clipboardFile)

        let paths = DataPaths.make(supportRoot: supportRoot)

        XCTAssertEqual(paths.primaryLegacyRoot?.lastPathComponent, "fieldtheory-mac")
        XCTAssertTrue(paths.legacyRoots.contains(fieldTheoryMac))
        XCTAssertTrue(paths.legacyRoots.contains(littleAIMac))
        XCTAssertEqual(paths.nativeRoot.lastPathComponent, "Field Theory Native")
    }

    @MainActor
    func testEnsureSafeFilesystemLayoutBacksUpLegacyFiles() throws {
        let fieldTheoryMac = supportRoot.appendingPathComponent("fieldtheory-mac", isDirectory: true)
        try FileManager.default.createDirectory(at: fieldTheoryMac, withIntermediateDirectories: true)

        try Data("legacy-clipboard".utf8).write(to: fieldTheoryMac.appendingPathComponent("clipboard.db"))
        try Data("legacy-prefs".utf8).write(to: fieldTheoryMac.appendingPathComponent("preferences.json"))
        try Data("legacy-session".utf8).write(to: fieldTheoryMac.appendingPathComponent("supabase-session.json"))

        let paths = DataPaths.make(supportRoot: supportRoot)
        let manager = DataSafetyManager(policy: .strict, paths: paths)
        try manager.ensureSafeFilesystemLayout()

        XCTAssertTrue(FileManager.default.fileExists(atPath: paths.backupMarkerURL.path))

        let backupRuns = try FileManager.default.contentsOfDirectory(
            at: paths.backupRoot,
            includingPropertiesForKeys: nil
        )
        XCTAssertEqual(backupRuns.count, 1)

        let copiedRoot = backupRuns[0].appendingPathComponent("fieldtheory-mac", isDirectory: true)
        XCTAssertTrue(FileManager.default.fileExists(atPath: copiedRoot.appendingPathComponent("clipboard.db").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: copiedRoot.appendingPathComponent("preferences.json").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: copiedRoot.appendingPathComponent("supabase-session.json").path))
    }
}
