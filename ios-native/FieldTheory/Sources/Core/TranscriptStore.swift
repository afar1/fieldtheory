import Foundation
import Observation

/// Voice items ("stacks"). Mirrors the data shape the previous mobile app
/// synced to the `transcripts` table, including camelCase stackSegments in
/// the metadata JSON.
@MainActor
@Observable
final class TranscriptStore {
    private let db: Database

    private(set) var items: [TranscriptItem] = []

    var onLocalChange: (() -> Void)?

    init(db: Database) {
        self.db = db
    }

    func reload() async {
        do {
            let rows = try await db.query("SELECT * FROM transcripts ORDER BY created_at_ms DESC")
            items = rows.map(Self.itemFromRow)
        } catch {
            items = []
        }
    }

    private static func itemFromRow(_ row: [String: SQLValue]) -> TranscriptItem {
        var segments: [TranscriptSegment]?
        if let json = row["segments_json"]?.stringValue, let data = json.data(using: .utf8) {
            segments = try? JSONDecoder().decode([TranscriptSegment].self, from: data)
        }
        return TranscriptItem(
            id: row["id"]?.stringValue ?? "",
            text: row["text"]?.stringValue ?? "",
            createdAtMs: row["created_at_ms"]?.intValue ?? 0,
            updatedAtMs: row["updated_at_ms"]?.intValue ?? 0,
            segments: segments
        )
    }

    private func segmentsJSON(_ segments: [TranscriptSegment]?) -> SQLValue {
        guard let segments, !segments.isEmpty,
              let data = try? JSONEncoder().encode(segments),
              let json = String(data: data, encoding: .utf8) else { return .null }
        return .text(json)
    }

    @discardableResult
    func add(text: String) async -> TranscriptItem {
        let now = Timestamps.nowMs()
        let item = TranscriptItem(
            id: "\(now)-\(String(UUID().uuidString.prefix(8)))",
            text: text,
            createdAtMs: now,
            updatedAtMs: now,
            segments: nil
        )
        try? await db.run("""
            INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
            VALUES (?, ?, ?, ?, NULL, 1)
            """, [.text(item.id), .text(text), .int(now), .int(now)])
        await reload()
        onLocalChange?()
        return item
    }

    func update(_ item: TranscriptItem, text: String) async {
        let now = Timestamps.nowMs()
        var segments = item.segments
        // Editing a single-segment stack rewrites that segment too.
        if var existing = segments, existing.count == 1 {
            existing[0].text = text
            existing[0].updatedAt = now
            segments = existing
        }
        try? await db.run("""
            UPDATE transcripts SET text = ?, updated_at_ms = ?, segments_json = ?, dirty = 1 WHERE id = ?
            """, [.text(text), .int(now), segmentsJSON(segments), .text(item.id)])
        await reload()
        onLocalChange?()
    }

    func delete(ids: [String]) async {
        let now = Timestamps.nowMs()
        for id in ids {
            try? await db.run("DELETE FROM transcripts WHERE id = ?", [.text(id)])
            try? await db.run("""
                INSERT INTO transcript_tombstones (id, deleted_at_ms) VALUES (?, ?)
                ON CONFLICT(id) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms
                """, [.text(id), .int(now)])
        }
        await reload()
        onLocalChange?()
    }

    /// Stacking: merge the given items into the first one, segments ordered
    /// chronologically, joined with blank lines — same as the previous app.
    func stack(ids: [String]) async {
        let stackedItems = items.filter { ids.contains($0.id) }
        guard stackedItems.count >= 2, let target = stackedItems.first else { return }
        let now = Timestamps.nowMs()

        var segments: [TranscriptSegment] = []
        for item in stackedItems {
            if let existing = item.segments, !existing.isEmpty {
                segments.append(contentsOf: existing)
            } else {
                segments.append(TranscriptSegment(id: item.id, text: item.text, createdAt: item.createdAtMs, updatedAt: item.updatedAtMs))
            }
        }
        segments.sort { $0.createdAt < $1.createdAt }
        let mergedText = segments.map(\.text).joined(separator: "\n\n")

        try? await db.run("""
            UPDATE transcripts SET text = ?, updated_at_ms = ?, segments_json = ?, dirty = 1 WHERE id = ?
            """, [.text(mergedText), .int(now), segmentsJSON(segments), .text(target.id)])

        let others = stackedItems.dropFirst().map(\.id)
        await delete(ids: Array(others))
    }

    /// Unstack: each segment becomes a standalone transcript again.
    func unstack(_ item: TranscriptItem) async {
        guard let segments = item.segments, segments.count > 1 else { return }
        let now = Timestamps.nowMs()
        for segment in segments {
            try? await db.run("""
                INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
                VALUES (?, ?, ?, ?, NULL, 1)
                ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at_ms = ?, dirty = 1
                """, [.text(segment.id), .text(segment.text), .int(segment.createdAt), .int(now), .int(now)])
        }
        await delete(ids: [item.id])
    }

    /// Stacking a file from Library or River: the file arrives as a segment
    /// whose text carries the filename header so downstream tools know what
    /// it is.
    func addFileSegment(fileName: String, content: String, into item: TranscriptItem?) async {
        let text = "File: \(fileName)\n\n\(content)"
        if let item {
            let now = Timestamps.nowMs()
            var segments = item.segments ?? [TranscriptSegment(id: item.id, text: item.text, createdAt: item.createdAtMs, updatedAt: item.updatedAtMs)]
            segments.append(TranscriptSegment(id: "\(now)-file", text: text, createdAt: now, updatedAt: now))
            segments.sort { $0.createdAt < $1.createdAt }
            let mergedText = segments.map(\.text).joined(separator: "\n\n")
            try? await db.run("""
                UPDATE transcripts SET text = ?, updated_at_ms = ?, segments_json = ?, dirty = 1 WHERE id = ?
                """, [.text(mergedText), .int(now), segmentsJSON(segments), .text(item.id)])
            await reload()
            onLocalChange?()
        } else {
            await add(text: text)
        }
    }
}
