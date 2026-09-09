#if targetEnvironment(simulator)
import Foundation

/// Voice-only fixture content for simulator preview mode.
enum PreviewFixtures {
    @MainActor
    static func seed(transcripts: TranscriptStore, db: Database) async {
        let privacyPreview = ProcessInfo.processInfo.arguments.contains("ft-privacy-preview")
        let layoutPreview = ProcessInfo.processInfo.arguments.contains("ft-card-layout-preview")
        let voiceFixtures: [(String, String, Int64)] = [
            ("t-1", "Remember to capture the idea before it disappears. Take a walk after lunch and bring a notebook.", 1),
            ("t-2", "For the next project, start with a small working version and leave room to change direction.", 5),
            ("t-3", "Grocery run: espresso beans, oat milk, and the good bread from the corner place.", 30),
        ]
        for (id, fixtureText, hoursAgo) in voiceFixtures {
            let text = layoutPreview && id == "t-1" ? String(repeating: fixtureText + " ", count: 5) : fixtureText
            let created = Timestamps.nowMs() - hoursAgo * 3_600_000
            if privacyPreview {
                try? await db.run("""
                    INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty, privacy_state, action_protocol)
                    VALUES (?, ?, ?, ?, NULL, 1, 'pending', 1)
                    ON CONFLICT(id) DO NOTHING
                    """, [.text(id), .text(text), .int(created), .int(created)])
            } else {
                try? await db.run("""
                    INSERT INTO transcripts (id, text, created_at_ms, updated_at_ms, segments_json, dirty, privacy_state, action_protocol)
                    VALUES (?, ?, ?, ?, NULL, 0, 'eligible', 1)
                    ON CONFLICT(id) DO NOTHING
                    """, [.text(id), .text(text), .int(created), .int(created)])
            }
        }
        if layoutPreview {
            try? await db.run("UPDATE transcripts SET acknowledged_updated_at_ms = updated_at_ms")
            try? await db.run("UPDATE transcripts SET agent_sent_revision = ? WHERE id = 't-2'", [.text(Hashing.sha256Hex(voiceFixtures[1].1))])
        }
        await transcripts.reload()
        if ProcessInfo.processInfo.arguments.contains("ft-delivery-preview"), let item = transcripts.items.first {
            let base = Date().addingTimeInterval(-60)
            let stages = ["uploaded", "received_by_mac", "queued", "started", "completed"]
            let events = stages.enumerated().map { index, stage in
                VoiceDeliveryEvent(event_id: stage, transcript_id: item.id, revision: Hashing.sha256Hex(item.text), stage: stage,
                    occurred_at: ISO8601DateFormatter().string(from: base.addingTimeInterval(Double(index * 10))), worker_id: "preview", time_source: stage == "started" ? "codex" : stage == "queued" ? "observed" : "server")
            }
            let presence = VoiceRunnerPresence(worker_id: "preview", observed_at: ISO8601DateFormatter().string(from: base), last_seen_at: ISO8601DateFormatter().string(from: base), locked: true, sleeping: false, online: true)
            let lock = VoiceRunnerEvent(event_id: "lock", worker_id: "preview", event: "lock", occurred_at: ISO8601DateFormatter().string(from: base))
            transcripts.updateDelivery(receipts: [], events: events, presence: [presence], runnerEvents: [lock])
        }
    }
}
#endif
