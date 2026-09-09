import CryptoKit
import Foundation

/// Streaming checksum and backup-exclusion helpers shared by downloaded speech assets.
enum ModelFileIntegrity {
    static func validate(_ url: URL, expectedMD5: String) throws {
        guard try md5HexStreaming(of: url) == expectedMD5 else {
            throw NSError(domain: "FieldTheory", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Model checksum mismatch — try again",
            ])
        }
        try excludeFromBackup(url)
    }

    static func excludeFromBackup(_ fileURL: URL) throws {
        var url = fileURL
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
    }

    /// MD5 in 1 MB chunks so model verification does not buffer whole assets.
    private static func md5HexStreaming(of fileURL: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { try? handle.close() }
        var hasher = Insecure.MD5()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
