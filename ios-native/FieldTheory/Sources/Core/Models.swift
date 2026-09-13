import Foundation

// MARK: - Library

struct LibraryDocMeta: Identifiable, Hashable {
    var clientId: String
    var sourcePath: String
    var title: String
    var remoteHash: String?
    var localHash: String?
    var remoteUpdatedAtMs: Int64
    var localUpdatedAtMs: Int64
    var createdAtMs: Int64
    var dirty: Bool
    var materialized: Bool

    var id: String { clientId }

    /// Top-level folder ("" for files at the library root).
    var folder: String {
        guard let slash = sourcePath.firstIndex(of: "/") else { return "" }
        return String(sourcePath[..<slash])
    }

    var fileName: String {
        sourcePath.split(separator: "/").last.map(String.init) ?? sourcePath
    }
}

struct LibraryFolder: Identifiable, Hashable {
    var name: String
    var documentCount: Int
    var latestUpdatedAtMs: Int64

    var id: String { name }

    var displayName: String { name.isEmpty ? "Library" : name }
}

// MARK: - River

struct RiverItem: Identifiable, Hashable {
    var id: String
    var title: String
    var content: String
    var authorCallsign: String?
    var authorInitials: String?
    var kind: String
    var originalSourcePath: String?
    var revision: Int
    var createdBy: String
    var createdAtMs: Int64
    var updatedAtMs: Int64
    /// Plain-text card preview, computed once at load (markdown stripping is
    /// too hot for render passes).
    var preview: String = ""

    var fileName: String {
        if let source = originalSourcePath?.split(separator: "/").last, !source.isEmpty {
            return String(source)
        }
        return "\(title).md"
    }

    /// What the copy button puts on the pasteboard: enough context for another
    /// app (or agent) to know what file this is.
    var clipboardText: String {
        "File: \(fileName)\n\n\(content)"
    }

    /// The remote account that published this item. This is deliberately kept
    /// separate from the callsign: callsigns can change, while an account
    /// block must continue to match future items from the same author.
    var authorID: String? {
        let trimmed = createdBy.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    var authorLabel: String {
        authorCallsign?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
            ?? authorInitials?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
            ?? "Unknown author"
    }
}

struct RiverBlockedAuthor: Identifiable, Hashable {
    let authorID: String
    let authorLabel: String
    let blockedAtMs: Int64

    var id: String { authorID }
}

enum RiverReportReason: String, CaseIterable, Identifiable {
    case harassment
    case hateOrDiscrimination
    case threatOrViolence
    case sexualOrGraphicContent
    case privacyOrPersonalInformation
    case intellectualProperty
    case other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .harassment: return "Harassment or bullying"
        case .hateOrDiscrimination: return "Hate or discrimination"
        case .threatOrViolence: return "Threat or violence"
        case .sexualOrGraphicContent: return "Sexual or graphic content"
        case .privacyOrPersonalInformation: return "Private or personal information"
        case .intellectualProperty: return "Intellectual property concern"
        case .other: return "Other concern"
        }
    }
}

/// The exact, user-reviewed context stored with an authenticated River report.
/// Creating a report does not remove content or decide its outcome.
struct RiverReportDraft: Equatable {
    let reportID: String
    let itemID: String
    let authorID: String?
    let title: String
    let sourcePath: String?
    let reason: RiverReportReason
    let notes: String

    init(
        item: RiverItem,
        reason: RiverReportReason,
        notes: String,
        reportID: String = UUID().uuidString
    ) {
        self.reportID = reportID
        self.itemID = item.id
        self.authorID = item.authorID
        self.title = item.title
        self.sourcePath = item.originalSourcePath
        self.reason = reason
        self.notes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Content is intentionally absent. Reports preserve enough stable
    /// metadata for a human reviewer to find the item without copying a
    /// potentially harmful document into the report record.
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

// MARK: - Voice / Transcripts

struct TranscriptSegment: Codable, Hashable, Identifiable {
    var id: String
    var text: String
    var createdAt: Int64
    var updatedAt: Int64
}

enum TranscriptPrivacyPolicy: String, Codable, Hashable {
    case awaitingOffer = "pending"
    case holding
    case uploadEligible = "eligible"
    case localOnly = "local_only"
}

enum TranscriptSyncState: Hashable {
    case awaitingPrivacyOffer
    case privacyHold(expiresAtMs: Int64)
    case localOnly
    case awaitingUpload
    case synced
}

struct TranscriptItem: Identifiable, Hashable {
    var id: String
    var text: String
    var createdAtMs: Int64
    var updatedAtMs: Int64
    var segments: [TranscriptSegment]?
    var privacyPolicy: TranscriptPrivacyPolicy
    var privacyDeadlineAtMs: Int64?
    var acknowledgedUpdatedAtMs: Int64?
    /// Highest revision that may have reached the server. This is set before
    /// dispatch so an ambiguous network failure still forces a later delete.
    var cloudExposureUpdatedAtMs: Int64?
    var actionProtocol: Bool
    var agentSentRevision: String?
    var agentStatus: String? = nil
    var agentStatusRevision: String? = nil
    var currentAgentStatus: String? { agentStatusRevision == Hashing.sha256Hex(text) ? agentStatus : nil }

    var isCloudSaved: Bool { acknowledgedUpdatedAtMs == updatedAtMs }
    var wasSentToAgent: Bool { agentSentRevision == Hashing.sha256Hex(text) }
    var actionPolicy: String {
        switch privacyPolicy {
        case .awaitingOffer, .holding: return "pending"
        case .localOnly: return "no_action"
        case .uploadEligible: return "send"
        }
    }


    init(
        id: String,
        text: String,
        createdAtMs: Int64,
        updatedAtMs: Int64,
        segments: [TranscriptSegment]?,
        privacyPolicy: TranscriptPrivacyPolicy = .uploadEligible,
        privacyDeadlineAtMs: Int64? = nil,
        acknowledgedUpdatedAtMs: Int64? = nil,
        cloudExposureUpdatedAtMs: Int64? = nil,
        actionProtocol: Bool = false,
        agentSentRevision: String? = nil
    ) {
        self.id = id
        self.text = text
        self.createdAtMs = createdAtMs
        self.updatedAtMs = updatedAtMs
        self.segments = segments
        self.privacyPolicy = privacyPolicy
        self.privacyDeadlineAtMs = privacyDeadlineAtMs
        self.acknowledgedUpdatedAtMs = acknowledgedUpdatedAtMs
        self.cloudExposureUpdatedAtMs = cloudExposureUpdatedAtMs
        self.actionProtocol = actionProtocol
        self.agentSentRevision = agentSentRevision
    }

    var isStack: Bool { (segments?.count ?? 0) > 1 }

    var syncState: TranscriptSyncState {
        switch privacyPolicy {
        case .awaitingOffer:
            return .awaitingPrivacyOffer
        case .holding:
            guard let privacyDeadlineAtMs else { return .awaitingPrivacyOffer }
            return .privacyHold(expiresAtMs: privacyDeadlineAtMs)
        case .localOnly:
            return .localOnly
        case .uploadEligible:
            return acknowledgedUpdatedAtMs == updatedAtMs ? .synced : .awaitingUpload
        }
    }
}

// MARK: - Time helpers

enum Timestamps {
    static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    private static let isoWithFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let iso: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func ms(fromISO string: String?) -> Int64 {
        guard let string, !string.isEmpty else { return 0 }
        let date = isoWithFraction.date(from: string) ?? iso.date(from: string)
        guard let date else { return 0 }
        return Int64(date.timeIntervalSince1970 * 1000)
    }

    static func iso(fromMs ms: Int64) -> String {
        isoWithFraction.string(from: Date(timeIntervalSince1970: Double(ms) / 1000))
    }
}
