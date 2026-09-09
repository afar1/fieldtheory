import Foundation

enum AccountDeletionConfirmation {
    static func matches(_ candidate: String, accountEmail: String?) -> Bool {
        guard let accountEmail else { return false }
        let normalizedCandidate = candidate.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedAccount = accountEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return !normalizedAccount.isEmpty && normalizedCandidate == normalizedAccount
    }
}
