import XCTest
@testable import FieldTheory

@MainActor
final class TranscriptStoreTests: XCTestCase {
    private func makeStore() throws -> TranscriptStore {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-tests-\(UUID().uuidString)")
        let db = try Database(path: dir.appendingPathComponent("test.sqlite").path)
        return TranscriptStore(db: db)
    }

    /// Regression: unstacking must restore every transcription, including the
    /// one whose id the stack row reused.
    func testStackThenUnstackKeepsAllTranscriptions() async throws {
        let store = try makeStore()
        let first = await store.add(text: "alpha")
        let second = await store.add(text: "bravo")
        let third = await store.add(text: "charlie")

        await store.stack(ids: [first.id, second.id, third.id])
        await store.reload()
        XCTAssertEqual(store.items.count, 1)
        guard let stack = store.items.first else { return XCTFail("missing stack") }
        XCTAssertEqual(stack.segments?.count, 3)
        XCTAssertTrue(stack.isStack)

        await store.unstack(stack)
        await store.reload()
        XCTAssertEqual(store.items.count, 3, "unstack lost a transcription")
        XCTAssertEqual(Set(store.items.map(\.text)), ["alpha", "bravo", "charlie"])
    }

    func testStackMergesChronologically() async throws {
        let store = try makeStore()
        let first = await store.add(text: "one")
        try await Task.sleep(nanoseconds: 3_000_000) // distinct createdAt ms
        let second = await store.add(text: "two")

        await store.stack(ids: [second.id, first.id])
        await store.reload()
        guard let stack = store.items.first else { return XCTFail("missing stack") }
        // Segments order by createdAt regardless of selection order.
        XCTAssertEqual(stack.text, "one\n\ntwo")
    }
}
