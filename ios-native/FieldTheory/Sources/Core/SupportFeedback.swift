import Foundation
import UIKit

/// An immutable, explicitly submitted snapshot. No audio, device name, or logs.
struct SupportFeedback: Codable, Equatable {
    let id: String
    let user_id: String
    let transcript_client_id: String
    let revision: String
    let transcript_text: String
    let transcript_created_at_ms: Int64
    let submitted_at_ms: Int64
    let action_policy: String
    let app_version: String
    let app_build: String
    let os_version: String
    let device_family: String
    let locale: String

    @MainActor
    init(item: TranscriptItem, userID: String) {
        id = UUID().uuidString.lowercased()
        user_id = userID
        transcript_client_id = item.id
        revision = Hashing.sha256Hex(item.text)
        transcript_text = item.text
        transcript_created_at_ms = item.createdAtMs
        submitted_at_ms = Timestamps.nowMs()
        action_policy = item.actionPolicy
        app_version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
        app_build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
        os_version = UIDevice.current.systemVersion
        device_family = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        locale = Locale.current.identifier
    }
}

extension Database {
    /// Account check and insertion share one actor turn, so a late UI action
    /// cannot enqueue data after sign-out or into another account's store.
    func enqueueFeedback(_ feedback: SupportFeedback) throws {
        guard try getMeta("storage_owner_user_id") == feedback.user_id else {
            throw DatabaseError(message: "Sign in again before submitting feedback.")
        }
        let payload = String(decoding: try JSONEncoder().encode(feedback), as: UTF8.self)
        try run("""
            INSERT OR IGNORE INTO support_feedback_outbox
                (id, user_id, transcript_id, revision, payload, sent)
            VALUES (?, ?, ?, ?, ?, 0)
            """, [.text(feedback.id), .text(feedback.user_id), .text(feedback.transcript_client_id),
                  .text(feedback.revision), .text(payload)])
    }

    func pendingFeedback(userID: String) throws -> [SupportFeedback] {
        try query("SELECT payload FROM support_feedback_outbox WHERE user_id = ? AND sent = 0 ORDER BY rowid LIMIT 50", [.text(userID)])
            .map { row in
                guard let payload = row["payload"]?.stringValue else {
                    throw DatabaseError(message: "Feedback queue could not be read.")
                }
                return try JSONDecoder().decode(SupportFeedback.self, from: Data(payload.utf8))
            }
    }
}
