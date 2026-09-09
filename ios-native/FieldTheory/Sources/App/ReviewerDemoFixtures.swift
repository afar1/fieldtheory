import Foundation

/// Small, plainly fictional Voice fixtures for App Review. AppModel supplies a
/// separate SQLite workspace and never starts SyncEngine while it is active.
enum ReviewerDemoFixtures {
    struct VoiceSample: Equatable {
        let id: String
        let text: String
        let hoursAgo: Int64
    }

    static let voiceSamples = [
        VoiceSample(
            id: "reviewer-demo-voice-1",
            text: "This is a sample Voice transcript. New recordings are transcribed on device after the speech model downloads.",
            hoursAgo: 1
        ),
        VoiceSample(
            id: "reviewer-demo-voice-2",
            text: "Try stacking two transcripts, editing the result, and separating the stack again. Demo changes are removed when you exit Reviewer Demo.",
            hoursAgo: 6
        ),
    ]

    @MainActor
    static func seed(
        library _: LibraryStore,
        river _: RiverStore,
        transcripts: TranscriptStore,
        db: Database
    ) async throws {
        try await db.reset()
        try await db.run("DELETE FROM recents")

        let now = Timestamps.nowMs()
        for sample in voiceSamples {
            let created = now - sample.hoursAgo * 3_600_000
            try await db.run("""
                INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
                VALUES (?, ?, ?, ?, NULL, 0)
                ON CONFLICT(id) DO UPDATE SET
                    text = excluded.text,
                    updated_at_ms = excluded.updated_at_ms,
                    segments_json = NULL,
                    dirty = 0
                """, [.text(sample.id), .text(sample.text), .int(created), .int(created)])
        }

        await transcripts.reload()
    }
}
