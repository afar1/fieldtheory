import CryptoKit
import Foundation

enum Hashing {
    /// sha256 hex, matching crypto.createHash('sha256').update(v).digest('hex')
    /// in the Mac sync service.
    static func sha256Hex(_ value: String) -> String {
        let digest = SHA256.hash(data: Data(value.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// client_id derivation from librarySyncService.ts:
    /// `library-${sha256(sourcePath).slice(0, 32)}`
    static func libraryClientId(sourcePath: String) -> String {
        "library-" + String(sha256Hex(sourcePath).prefix(32))
    }

    static func md5Hex(of fileURL: URL) throws -> String {
        let data = try Data(contentsOf: fileURL)
        return Insecure.MD5.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

/// Path rules shared with the Mac's librarySyncService.ts.
enum LibraryPaths {
    /// Port of normalizeLibrarySourcePath: relative, traversal-free, .md-suffixed.
    static func normalize(_ sourcePath: String?, title: String) -> String? {
        let fallback = "scratchpad/\(safeFileName(title)).md"
        var raw = (sourcePath?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 } ?? fallback
        raw = raw.replacingOccurrences(of: "\\", with: "/")
        if raw.hasPrefix("/") { return nil }
        var parts = raw.split(separator: "/").map(String.init)
        if parts.isEmpty { return fallback }
        if parts.contains(where: { $0 == "." || $0 == ".." }) { return nil }
        if !parts[parts.count - 1].lowercased().hasSuffix(".md") {
            parts[parts.count - 1] += ".md"
        }
        return parts.joined(separator: "/")
    }

    /// Port of safeFileName: strips path-hostile characters, caps length.
    static func safeFileName(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = trimmed.isEmpty ? "Untitled" : trimmed
        let invalid = CharacterSet(charactersIn: "\\/:*?\"<>|")
        let cleaned = base.components(separatedBy: invalid).joined(separator: "-")
        return String(cleaned.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).prefix(120))
    }
}
