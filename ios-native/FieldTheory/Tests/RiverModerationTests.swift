import XCTest
@testable import FieldTheory

@MainActor
final class RiverModerationTests: XCTestCase {
    private func makeDatabase() throws -> Database {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-river-moderation-tests-\(UUID().uuidString)")
        return try Database(path: dir.appendingPathComponent("test.sqlite").path)
    }

    private func insertRiverItem(
        _ db: Database,
        id: String,
        authorID: String,
        callsign: String
    ) async throws {
        try await db.run("""
            INSERT INTO river_items
                (id, title, content, author_callsign, kind, revision, created_by, created_at_ms, updated_at_ms)
            VALUES (?, ?, ?, ?, 'document', 1, ?, 1, 1)
            """, [
                .text(id), .text("Title \(id)"), .text("Body \(id)"),
                .text(callsign), .text(authorID)
            ])
    }

    func testBlockFiltersExistingAndFutureItemsFromTheSameAuthor() async throws {
        let db = try makeDatabase()
        // The production migration owns this table. Creating its documented
        // shape here keeps this store test focused on its behavior.
        try await db.run("""
            CREATE TABLE IF NOT EXISTS river_blocked_authors (
                author_id TEXT PRIMARY KEY,
                author_label TEXT NOT NULL DEFAULT '',
                blocked_at_ms INTEGER NOT NULL
            )
            """)
        try await insertRiverItem(db, id: "one", authorID: "author-a", callsign: "A")
        try await insertRiverItem(db, id: "two", authorID: "author-b", callsign: "B")

        let store = RiverStore(db: db)
        await store.reload()
        XCTAssertEqual(Set(store.items.map(\.id)), ["one", "two"])

        guard let first = store.items.first(where: { $0.id == "one" }) else {
            return XCTFail("missing seeded River item")
        }
        let didBlock = await store.blockAuthor(of: first)
        XCTAssertTrue(didBlock)
        XCTAssertEqual(store.items.map(\.id), ["two"])
        XCTAssertEqual(store.blockedAuthors.map(\.authorID), ["author-a"])

        try await insertRiverItem(db, id: "three", authorID: "author-a", callsign: "A")
        await store.reload()
        XCTAssertEqual(store.items.map(\.id), ["two"], "the detail/list source must hide later items from a blocked author")

        guard let blocked = store.blockedAuthors.first else { return XCTFail("missing blocked author") }
        let didUnblock = await store.unblockAuthor(blocked)
        XCTAssertTrue(didUnblock)
        XCTAssertEqual(Set(store.items.map(\.id)), ["one", "two", "three"])
    }

    func testReportDraftIdentifiesTheItemWithoutCopyingDocumentContent() {
        let item = RiverItem(
            id: "doc-123",
            title: "A concern",
            content: "DO NOT COPY THIS DOCUMENT BODY",
            authorCallsign: "RIV",
            authorInitials: "RV",
            kind: "document",
            originalSourcePath: "private/concern.md",
            revision: 1,
            createdBy: "author-456",
            createdAtMs: 1,
            updatedAtMs: 2
        )
        let draft = RiverReportDraft(
            item: item,
            reason: .harassment,
            notes: "Please review this.",
            reportID: "report-789"
        )

        XCTAssertEqual(draft.reportID, "report-789")
        XCTAssertEqual(draft.itemID, "doc-123")
        XCTAssertEqual(draft.authorID, "author-456")
        XCTAssertEqual(draft.notes, "Please review this.")
        XCTAssertFalse(draft.title.contains(item.content))
    }
}

private enum ReportTransportFailure: Error {
    case network
}

private actor FakeRiverReportTransport: RiverReportTransport {
    enum InsertBehavior {
        case responds(UUID)
        case fails
    }

    enum ConfirmationBehavior {
        case exists
        case missing
        case fails
    }

    private let insertBehavior: InsertBehavior
    private let confirmationBehavior: ConfirmationBehavior
    private var insertedReports: [RiverContentReportPayload] = []
    private var confirmationRequests: [(id: UUID, reporterID: UUID)] = []

    init(insert: InsertBehavior, confirmation: ConfirmationBehavior) {
        insertBehavior = insert
        confirmationBehavior = confirmation
    }

    func insert(_ report: RiverContentReportPayload) throws -> UUID {
        insertedReports.append(report)
        switch insertBehavior {
        case .responds(let id): return id
        case .fails: throw ReportTransportFailure.network
        }
    }

    func reportExists(id: UUID, reporterID: UUID) throws -> Bool {
        confirmationRequests.append((id, reporterID))
        switch confirmationBehavior {
        case .exists: return true
        case .missing: return false
        case .fails: throw ReportTransportFailure.network
        }
    }

    func insertCount() -> Int { insertedReports.count }
    func confirmationCount() -> Int { confirmationRequests.count }
    func firstConfirmation() -> (UUID, UUID)? {
        confirmationRequests.first.map { ($0.id, $0.reporterID) }
    }
}

@MainActor
extension RiverModerationTests {
    private func validReportDraft(
        reportID: UUID = UUID(),
        documentID: UUID = UUID(),
        authorID: UUID = UUID()
    ) -> RiverReportDraft {
        let item = RiverItem(
            id: documentID.uuidString,
            title: "A concern",
            content: "Document content remains outside the report payload.",
            authorCallsign: "RIV",
            authorInitials: "RV",
            kind: "document",
            originalSourcePath: "library/concern.md",
            revision: 1,
            createdBy: authorID.uuidString,
            createdAtMs: 1,
            updatedAtMs: 2
        )
        return RiverReportDraft(
            item: item,
            reason: .harassment,
            notes: "Please review.",
            reportID: reportID.uuidString.uppercased()
        )
    }

    func testReportAcceptsCanonicalPostgresUUIDResponse() async throws {
        let reportID = UUID()
        let reporterID = UUID()
        let transport = FakeRiverReportTransport(
            insert: .responds(reportID),
            confirmation: .missing
        )

        let result = try await RiverModerationService.submitReport(
            validReportDraft(reportID: reportID),
            reporterID: reporterID,
            transport: transport
        )

        let confirmationCount = await transport.confirmationCount()
        XCTAssertEqual(result, .submitted)
        XCTAssertEqual(confirmationCount, 0)
    }

    func testReportConfirmsOwnReportAfterLostInsertResponse() async throws {
        let reportID = UUID()
        let reporterID = UUID()
        let transport = FakeRiverReportTransport(
            insert: .fails,
            confirmation: .exists
        )

        let result = try await RiverModerationService.submitReport(
            validReportDraft(reportID: reportID),
            reporterID: reporterID,
            transport: transport
        )

        let insertCount = await transport.insertCount()
        let confirmationCount = await transport.confirmationCount()
        let confirmation = await transport.firstConfirmation()
        XCTAssertEqual(result, .confirmedAfterUnknownInsert)
        XCTAssertEqual(insertCount, 1)
        XCTAssertEqual(confirmationCount, 1)
        XCTAssertEqual(confirmation?.0, reportID)
        XCTAssertEqual(confirmation?.1, reporterID)
    }

    func testReportLeavesStatusUnknownWithoutRetryAfterUnconfirmedInsert() async throws {
        let reportID = UUID()
        let reporterID = UUID()
        let transport = FakeRiverReportTransport(
            insert: .fails,
            confirmation: .fails
        )

        let result = try await RiverModerationService.submitReport(
            validReportDraft(reportID: reportID),
            reporterID: reporterID,
            transport: transport
        )

        let insertCount = await transport.insertCount()
        let confirmationCount = await transport.confirmationCount()
        let confirmation = await transport.firstConfirmation()
        XCTAssertEqual(result, .statusUnknown)
        XCTAssertEqual(insertCount, 1)
        XCTAssertEqual(confirmationCount, 1)
        XCTAssertEqual(confirmation?.0, reportID)
        XCTAssertEqual(confirmation?.1, reporterID)
    }

    func testReportRejectsMissingAuthorBeforeTransport() async throws {
        let reportID = UUID()
        let item = RiverItem(
            id: UUID().uuidString,
            title: "No author",
            content: "Body",
            authorCallsign: nil,
            authorInitials: nil,
            kind: "document",
            originalSourcePath: nil,
            revision: 1,
            createdBy: "",
            createdAtMs: 1,
            updatedAtMs: 1
        )
        let draft = RiverReportDraft(item: item, reason: .other, notes: "", reportID: reportID.uuidString)
        let transport = FakeRiverReportTransport(insert: .fails, confirmation: .missing)

        do {
            _ = try await RiverModerationService.submitReport(
                draft,
                reporterID: UUID(),
                transport: transport
            )
            XCTFail("Expected the missing author to be rejected before transport")
        } catch {
            XCTAssertEqual(error as? RiverModerationError, .unsupportedAuthor)
        }
        let insertCount = await transport.insertCount()
        XCTAssertEqual(insertCount, 0)
    }
}
