import Foundation

@MainActor
final class InMemoryClipboardStore: ClipboardStore {
    let supportsDelete: Bool = false

    private var items: [ClipboardItem] = [
        ClipboardItem(
            type: .transcript,
            content: "Native scaffold booted. Wire whisper pipeline next.",
            createdAt: Date(),
            source: .mac,
            wordCount: 8
        ),
    ]

    func fetchRecent(limit: Int) -> [ClipboardItem] {
        Array(items.prefix(limit))
    }

    func insert(_ item: ClipboardItem) {
        items.insert(item, at: 0)
    }

    func delete(id: Int64) {
        // Safety default: no destructive operations in fallback mode.
    }
}
