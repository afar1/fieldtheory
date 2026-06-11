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
