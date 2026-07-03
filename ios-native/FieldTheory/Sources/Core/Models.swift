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
}

// MARK: - Voice / Transcripts

struct TranscriptSegment: Codable, Hashable, Identifiable {
    var id: String
    var text: String
    var createdAt: Int64
    var updatedAt: Int64
}

struct TranscriptItem: Identifiable, Hashable {
    var id: String
    var text: String
    var createdAtMs: Int64
    var updatedAtMs: Int64
    var segments: [TranscriptSegment]?

    var isStack: Bool { (segments?.count ?? 0) > 1 }
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
