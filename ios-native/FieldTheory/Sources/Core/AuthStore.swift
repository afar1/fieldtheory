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
@MainActor
@Observable
final class AuthStore {
    let client: SupabaseClient

    private(set) var phase: AuthPhase = .loading
    private(set) var pendingEmail: String?
    var lastError: String?
    var onPhaseChange: ((AuthPhase) -> Void)?

    private var stateTask: Task<Void, Never>?

    init(client: SupabaseClient) {
        self.client = client
        stateTask = Task { [weak self] in
            guard let self else { return }
            for await (event, session) in client.auth.authStateChanges {
                guard [.initialSession, .signedIn, .signedOut, .tokenRefreshed].contains(event) else { continue }
                let next: AuthPhase
                if let session {
                    next = .signedIn(userId: session.user.id, email: session.user.email)
                } else {
                    next = .signedOut
                }
                let changed = next != self.phase
                self.phase = next
                if changed { self.onPhaseChange?(next) }
            }
        }
    }

    var userId: UUID? {
        if case .signedIn(let id, _) = phase { return id }
        return nil
    }

    var email: String? {
        if case .signedIn(_, let email) = phase { return email }
        return nil
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
