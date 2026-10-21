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
            try? await db.run("UPDATE transcripts SET privacy_state = 'local_only' WHERE id = 't-1'")
            try? await db.run("UPDATE transcripts SET acknowledged_updated_at_ms = updated_at_ms")
            try? await db.run("UPDATE transcripts SET agent_sent_revision = ? WHERE id = 't-2'", [.text(Hashing.sha256Hex(voiceFixtures[1].1))])
        }
        if ProcessInfo.processInfo.arguments.contains("ft-stack-preview") {
            let segments = [TranscriptSegment(id: "one", text: "First segment", createdAt: 1, updatedAt: 1), TranscriptSegment(id: "two", text: "Second segment", createdAt: 2, updatedAt: 2)]
            if let data = try? JSONEncoder().encode(segments) {
                try? await db.run("UPDATE transcripts SET segments_json = ? WHERE id = 't-1'", [.text(String(decoding: data, as: UTF8.self))])
            }
        }
        await transcripts.reload()
        let arguments = ProcessInfo.processInfo.arguments
        let deliveryStage = arguments.enumerated().first(where: { $0.element == "ft-delivery-stage" })
            .flatMap { arguments.indices.contains($0.offset + 1) ? arguments[$0.offset + 1] : nil }
        if (arguments.contains("ft-delivery-preview") || deliveryStage != nil), let item = transcripts.items.first {
            if deliveryStage == "send_to_agent" {
                try? await db.run("UPDATE transcripts SET privacy_state = 'local_only' WHERE id = ?", [.text(item.id)])
                await transcripts.reload()
            } else if deliveryStage == "sent_to_agent" {
                try? await db.run("UPDATE transcripts SET agent_sent_revision = ? WHERE id = ?", [.text(Hashing.sha256Hex(item.text)), .text(item.id)])
                await transcripts.reload()
            }
            let base = Date().addingTimeInterval(-60)
            let stages = deliveryStage.flatMap {
                if $0 == "send_to_agent" { return ["uploaded"] }
                return ["saved_on_phone", "sent_to_agent"].contains($0) ? nil : [$0]
            }
                ?? (arguments.contains("ft-delivery-preview") ? ["uploaded", "received_by_mac", "queued", "started", "completed"] : [])
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
