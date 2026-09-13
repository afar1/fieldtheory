import Foundation

struct VoiceDeliveryEvent: Decodable, Hashable, Identifiable {
    let event_id: String
    let transcript_id: String
    let revision: String
    let stage: String
    let occurred_at: String
    let worker_id: String?
    var time_source: String? = nil
    var id: String { event_id }
    var date: Date? { VoiceDelivery.date(occurred_at) }
}

struct VoiceRunnerPresence: Decodable, Hashable {
    let worker_id: String
    let observed_at: String?
    let last_seen_at: String
    let locked: Bool?
    let sleeping: Bool?
    let online: Bool?
}

struct VoiceRunnerEvent: Decodable, Hashable, Identifiable {
    let event_id: String
    let worker_id: String
    let event: String
    var online: Bool? = nil
    let occurred_at: String
    var id: String { event_id }
    var date: Date? { VoiceDelivery.date(occurred_at) }
}

enum VoiceDelivery {
    static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    static func label(_ stage: String) -> String {
        switch stage {
        case "uploaded": return "Uploaded"
        case "received_by_mac": return "Received by Mac"
        case "queued": return "Queued in Codex"
        case "started": return "Working"
        case "completed": return "Complete"
        case "context": return "Saved as context"
        case "needs_user": return "Needs you"
        case "failed": return "Failed"
        case "cancelled": return "Cancelled"
        case "superseded": return "Replaced by newer version"
        default: return "Saved on phone"
        }
    }

    static func isInProgress(_ status: String) -> Bool {
        ["Saved on phone", "Uploaded", "Received by Mac", "Queued in Codex", "Working"].contains(status)
    }

    static func status(item: TranscriptItem, events: [VoiceDeliveryEvent], receipt: VoiceAgentReceipt?) -> String {
        let matching = events.filter { $0.transcript_id == item.id && $0.revision == Hashing.sha256Hex(item.text) }
            .sorted { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }
        let terminal = ["completed", "context", "needs_user", "failed", "cancelled", "superseded"]
        // A completed run can truthfully report blockers or partial work.
        // Only a terminal receipt with actual result text establishes this.
        if let receipt, receipt.transcript_id == item.id,
           receipt.revision == Hashing.sha256Hex(item.text),
           terminal.contains(receipt.status), receipt.hasUsableResult { return "Complete" }
        if item.actionPolicy != "send", !item.wasSentToAgent, receipt?.confirmed != true,
           matching.allSatisfy({ ["uploaded", "cancelled", "superseded"].contains($0.stage) }) { return "Send to agent" }

        if let event = matching.last(where: { terminal.contains($0.stage) }) { return label(event.stage) }
        if let receipt, receipt.revision == Hashing.sha256Hex(item.text) {
            if terminal.contains(receipt.status) {
                return label(receipt.status)
            }
            if receipt.confirmed { return "Working" }
        }
        for stage in ["started", "queued", "received_by_mac", "uploaded"] {
            if matching.contains(where: { $0.stage == stage }) { return label(stage) }
        }
        if item.wasSentToAgent { return "Sent to agent" }
        return item.isCloudSaved ? "Uploaded" : "Saved on phone"
    }
}
