import Foundation
import Supabase

enum AuthPhase: Equatable {
    case loading
    case signedOut
    case signedIn(userId: UUID, email: String?)
}

/// Email + OTP auth against the shared Field Theory Supabase project, the
/// same flow the previous mobile app used. supabase-swift persists the
/// session in the keychain and auto-refreshes tokens.
///
/// Local-first rule: who you ARE is separate from whether the session is
/// currently alive. Identity persists locally on first sign-in and only an
/// explicit sign-out clears it — losing internet (or a failed token refresh)
/// never bounces the app to the login screen and never touches local data.
@MainActor
@Observable
final class AuthStore {
    let client: SupabaseClient

    private(set) var phase: AuthPhase = .loading
    /// Locally persisted identity; the app works offline against this.
    private(set) var localUserId: UUID?
    private(set) var localEmail: String?
    private(set) var pendingEmail: String?
    var lastError: String?
    var onPhaseChange: ((AuthPhase) -> Void)?

    private var stateTask: Task<Void, Never>?
    private let defaults = UserDefaults.standard

    init(client: SupabaseClient) {
        self.client = client
        localUserId = defaults.string(forKey: "ft-user-id").flatMap(UUID.init(uuidString:))
        localEmail = defaults.string(forKey: "ft-user-email")

        stateTask = Task { [weak self] in
            guard let self else { return }
            for await (event, session) in client.auth.authStateChanges {
                guard [.initialSession, .signedIn, .signedOut, .tokenRefreshed].contains(event) else { continue }
                let next: AuthPhase
                if let session {
                    next = .signedIn(userId: session.user.id, email: session.user.email)
                    self.persistIdentity(userId: session.user.id, email: session.user.email)
                } else {
                    next = .signedOut
                }
                let changed = next != self.phase
                self.phase = next
                if changed { self.onPhaseChange?(next) }
            }
        }
    }

    /// True when the app has someone to be — live session or not.
    var hasIdentity: Bool { localUserId != nil }

    /// True when the auth session itself is alive (sync can run).
    var sessionAlive: Bool {
        if case .signedIn = phase { return true }
        return false
    }

    var userId: UUID? {
        if case .signedIn(let id, _) = phase { return id }
        return localUserId
    }

    var email: String? {
        if case .signedIn(_, let email) = phase { return email }
        return localEmail
    }

    private func persistIdentity(userId: UUID, email: String?) {
        localUserId = userId
        localEmail = email
        defaults.set(userId.uuidString, forKey: "ft-user-id")
        defaults.set(email, forKey: "ft-user-email")
    }

    /// Explicit sign-out only — the single path that clears identity.
    func clearIdentity() {
        localUserId = nil
        localEmail = nil
        defaults.removeObject(forKey: "ft-user-id")
        defaults.removeObject(forKey: "ft-user-email")
    }

    func sendCode(to email: String) async -> Bool {
        lastError = nil
        do {
            try await client.auth.signInWithOTP(email: email, shouldCreateUser: false)
            pendingEmail = email
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    func verifyCode(_ code: String) async -> Bool {
        guard let email = pendingEmail else { return false }
        lastError = nil
        do {
            try await client.auth.verifyOTP(email: email, token: code, type: .email)
            pendingEmail = nil
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    func signOut() async {
        try? await client.auth.signOut()
    }
}
