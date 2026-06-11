#if targetEnvironment(simulator)
import Foundation

/// Fixture content for simulator preview mode only.
enum PreviewFixtures {
    @MainActor
    static func seed(library: LibraryStore, river: RiverStore, transcripts: TranscriptStore, db: Database) async {
        let sampleDoc = """
        # Reading on glass

        A reader is a room. The best rooms disappear: you notice the *words*, \
        not the walls. This note exists to test **bold**, *italics*, `inline code`, \
        and [links](https://example.com) in the immersive view.

        ## What to check

        - Line height should breathe
        - Serif and sans presets should swap cleanly
        - [ ] An open task
        - [x] A finished task

        > Block quotes get a quiet left rail, the way margins hold a pencil note.

        ```swift
        let theory = Field(of: .markdown)
        ```

        1. Ordered lists
        2. Continue properly
        3. And nest when needed
        """

        let secondDoc = """
        # Scratch — riffs

        Talking to the machine while walking. The [[wiki link]] style gets the accent tint.

        - Capture is sacred
        - Triage is optional
        """

        // Stress fixture: a long real-world-sized document for freeze checks.
        let bigDoc = (1...250).map { index in
            """
            ## Section \(index)

            A paragraph with **bold**, *italics*, `code`, and a [link](https://example.com) \
            to keep the inline pipeline honest while we scroll through a long document.

            - Point one for section \(index)
            - [ ] An open task
            - [x] A finished task

            > A quote to break the rhythm.
            """
        }.joined(separator: "\n\n")

        for (path, content) in [
            ("scratchpad/Reading on glass.md", sampleDoc + "\n\n" + bigDoc),
            ("scratchpad/Riffs.md", secondDoc),
            ("Plans/Mobile launch.md", "# Mobile launch\n\n- [ ] Ship the river\n- [ ] Ship voice\n- [x] Build the scaffold"),
            ("artifacts/Council notes.md", "# Council notes\n\nThe council voted to keep things simple."),
        ] {
            let url = LibraryStore.libraryRoot.appendingPathComponent(path)
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? content.write(to: url, atomically: true, encoding: .utf8)
            let clientId = Hashing.libraryClientId(sourcePath: path)
            let now = Timestamps.nowMs()
            try? await db.run("""
                INSERT INTO library_index (client_id, source_path, title, remote_hash, local_hash, remote_updated_at_ms, local_updated_at_ms, created_at_ms, dirty, materialized)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
                ON CONFLICT(client_id) DO NOTHING
                """, [
                    .text(clientId), .text(path),
                    .text((path as NSString).lastPathComponent.replacingOccurrences(of: ".md", with: "")),
                    .text("fixture"), .text("fixture"), .int(now), .int(now), .int(now),
                ])
        }

        let riverFixtures: [(String, String, String, Int64)] = [
            ("river-1", "On partial replicas", "# On partial replicas\n\nThe phone holds a subset. Absence is not deletion.\n\n- The index knows everything\n- The disk holds what you chose", 2),
            ("river-2", "Mailbox, resurrected", "Swipe right to mark read. The gesture outlived the app that invented it.\n\n> Interaction grammars are more durable than products.", 26),
            ("river-3", "Why serif for reading", "Source Serif 4 carries the Mac's reading voice onto glass. **Same family, same measure.**", 49),
        ]
        for (id, title, content, hoursAgo) in riverFixtures {
            let updated = Timestamps.nowMs() - hoursAgo * 3_600_000
            try? await db.run("""
                INSERT INTO river_items (id, title, content, author_callsign, author_initials, kind, original_source_path, revision, created_by, created_at_ms, updated_at_ms)
                VALUES (?, ?, ?, ?, ?, 'document', ?, 1, 'fixture', ?, ?)
                ON CONFLICT(id) DO NOTHING
                """, [
                    .text(id), .text(title), .text(content),
                    .text(id == "river-2" ? "MAV" : "AF"), .text("AF"),
                    .text("scratchpad/\(title).md"), .int(updated), .int(updated),
                ])
        }

        let voiceFixtures: [(String, String, Int64)] = [
            ("t-1", "Remember to wire the floating mic so it inserts at the cursor when I'm editing and saves to voice when I'm not.", 1),
            ("t-2", "Idea: the river reader should page horizontally like flipping cards, content scrolls vertically inside each card.", 5),
            ("t-3", "Grocery run: espresso beans, oat milk, and the good bread from the corner place.", 30),
        ]
        for (id, text, hoursAgo) in voiceFixtures {
            let created = Timestamps.nowMs() - hoursAgo * 3_600_000
            try? await db.run("""
                INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty)
                VALUES (?, ?, ?, ?, NULL, 0)
                ON CONFLICT(id) DO NOTHING
                """, [.text(id), .text(text), .int(created), .int(created)])
        }
    }
}
#endif
