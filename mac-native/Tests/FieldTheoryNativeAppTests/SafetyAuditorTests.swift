import Foundation
import XCTest
@testable import FieldTheoryNativeApp

final class SafetyAuditorTests: XCTestCase {
    private var tempRoot: URL!
    private var supportRoot: URL!

    override func setUpWithError() throws {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("field-theory-native-audit-tests-\(UUID().uuidString)", isDirectory: true)
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
    func testStrictDefaultsPassBlockingChecks() throws {
        let paths = DataPaths.make(supportRoot: supportRoot)
        let safetyManager = DataSafetyManager(policy: .strict, paths: paths)
        try safetyManager.ensureSafeFilesystemLayout()

        let auditor = SafetyAuditor()
        let report = auditor.audit(
            policy: .strict,
            paths: paths,
            clipboardStore: FakeClipboardStore(supportsDelete: false),
            syncService: FakeSyncService(supportsCloudWrites: false)
        )

        XCTAssertTrue(report.blockingIssues.isEmpty)
        XCTAssertTrue(report.summaryLine.contains("passed"))
    }

    @MainActor
    func testCloudWritesTriggerBlockingFailure() throws {
        let paths = DataPaths.make(supportRoot: supportRoot)
        let safetyManager = DataSafetyManager(policy: .strict, paths: paths)
        try safetyManager.ensureSafeFilesystemLayout()

        let auditor = SafetyAuditor()
        let report = auditor.audit(
            policy: .strict,
            paths: paths,
            clipboardStore: FakeClipboardStore(supportsDelete: false),
            syncService: FakeSyncService(supportsCloudWrites: true)
        )

        XCTAssertFalse(report.blockingIssues.isEmpty)
        XCTAssertTrue(report.blockingIssues.contains { $0.id == "cloud.writes" })
    }
}

@MainActor
private final class FakeClipboardStore: ClipboardStore {
    let supportsDelete: Bool
    private var items: [ClipboardItem] = []

    init(supportsDelete: Bool) {
        self.supportsDelete = supportsDelete
    }

    func fetchRecent(limit: Int) -> [ClipboardItem] {
        Array(items.prefix(limit))
    }

    func insert(_ item: ClipboardItem) {
        items.insert(item, at: 0)
    }

    func delete(id: Int64) {
        items.removeAll { $0.id == id }
    }
}

@MainActor
private final class FakeSyncService: SyncService {
    let supportsCloudWrites: Bool

    init(supportsCloudWrites: Bool) {
        self.supportsCloudWrites = supportsCloudWrites
    }

    func currentStatus() -> SyncStatus {
        .disconnected
    }
}
