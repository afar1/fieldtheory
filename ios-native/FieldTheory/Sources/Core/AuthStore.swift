import Foundation
import Supabase

enum AuthPhase: Equatable {
    case loading
    case signedOut
    case signedIn(userId: UUID, email: String?)
}

enum AccountDeletionState: Equatable {
    case idle
    case deleting
    case failed(String)
    case succeeded
}

private struct AccountDeletionResponse: Decodable {
    let success: Bool
}

struct AccountDeletionSession: Equatable {
    let userID: UUID
    let accessToken: String
}

typealias AccountDeletionSessionProvider = @MainActor () async throws -> AccountDeletionSession
typealias AccountDeletionRequester = @MainActor (_ accessToken: String) async throws -> Bool

private struct AccountDeletionErrorBody: Decodable {
    let error: String?
}

enum AccountDeletionMessages {
    static func message(statusCode: Int, data: Data) -> String {
        let body = try? JSONDecoder().decode(AccountDeletionErrorBody.self, from: data)
        if let message = body?.error, !message.isEmpty {
            return message
        }
        switch statusCode {
        case 401:
            return "Your session expired. Sign out, sign in again, and retry account deletion."
        case 404:
            return "Account deletion is unavailable right now. Contact support for help."
        default:
            return "Account deletion did not finish. Please try again or contact support."
        }
    }

    static func message(for error: Error) -> String {
        if let functionsError = error as? FunctionsError,
           case .httpError(let code, let data) = functionsError {
            return message(statusCode: code, data: data)
        }
        return "Account deletion did not finish. Check your connection and try again."
    }
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
    private(set) var isReviewerDemo = false
    private(set) var accountDeletionState: AccountDeletionState = .idle
    var lastError: String?
    var onPhaseChange: ((AuthPhase) -> Void)?

    private var stateTask: Task<Void, Never>?
    private let defaults: UserDefaults
    private let accountDeletionSession: AccountDeletionSessionProvider
    private let accountDeletionRequest: AccountDeletionRequester

    init(
        client: SupabaseClient,
        defaults: UserDefaults = .standard,
        initialPhase: AuthPhase = .loading,
        observeAuthChanges: Bool = true,
        accountDeletionSession: AccountDeletionSessionProvider? = nil,
        accountDeletionRequest: AccountDeletionRequester? = nil
    ) {
        self.client = client
        self.defaults = defaults
        self.phase = initialPhase
        self.accountDeletionSession = accountDeletionSession ?? {
            let session = try await client.auth.session
            return AccountDeletionSession(userID: session.user.id, accessToken: session.accessToken)
        }
        self.accountDeletionRequest = accountDeletionRequest ?? { accessToken in
            let response: AccountDeletionResponse = try await client.functions.invoke(
                "delete-account",
                options: FunctionInvokeOptions(
                    headers: ["Authorization": "Bearer \(accessToken)"],
                    timeoutInterval: 60
                )
            )
            return response.success
        }
        localUserId = defaults.string(forKey: "ft-user-id").flatMap(UUID.init(uuidString:))
        localEmail = defaults.string(forKey: "ft-user-email")

        if observeAuthChanges {
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

    var accountDeletionError: String? {
        if case .failed(let message) = accountDeletionState { return message }
        return nil
    }

    /// Reviewer Demo is an explicitly unauthenticated local workspace. AppModel
    /// owns the isolated database/files and never starts sync for this state.
    func beginReviewerDemo() {
        isReviewerDemo = true
        lastError = nil
        accountDeletionState = .idle
    }

    func endReviewerDemo() {
        isReviewerDemo = false
        accountDeletionState = .idle
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
        guard accountDeletionState != .deleting else { return false }
        lastError = nil
        do {
            // Supabase email signup is enabled for this project. This matches
            // the existing mobile and Mac clients: a first OTP creates the
            // account, while later OTPs sign the same address in.
            try await client.auth.signInWithOTP(email: email, shouldCreateUser: true)
            pendingEmail = email
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    func verifyCode(_ code: String) async -> Bool {
        guard accountDeletionState != .deleting else { return false }
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
        try? await client.auth.signOut(scope: .local)
    }

    /// Permanently deletes the authenticated server account through the
    /// existing Edge Function. AppModel supplies local cleanup as the success
    /// callback, so a failed server request can never masquerade as deletion
    /// by merely signing the user out.
    func deleteAccount(onSuccess: @MainActor () async -> Void = {}) async -> Bool {
        guard !isReviewerDemo else {
            accountDeletionState = .failed("Reviewer Demo has no account to delete.")
            return false
        }
        guard case .signedIn(let expectedUserID, _) = phase else {
            accountDeletionState = .failed("Connect to the internet and sign in again before deleting your account.")
            return false
        }

        accountDeletionState = .deleting
        do {
            // This refreshes an expired token before the destructive request.
            let session = try await accountDeletionSession()
            guard session.userID == expectedUserID else {
                accountDeletionState = .failed("The active session changed. Sign in again before deleting your account.")
                return false
            }

            guard try await accountDeletionRequest(session.accessToken) else {
                accountDeletionState = .failed("Account deletion did not finish. Please try again or contact support.")
                return false
            }

            // The function response can arrive after UI state has changed.
            // Never wipe another account's device data in that race.
            guard case .signedIn(let currentUserID, _) = phase,
                  currentUserID == expectedUserID,
                  localUserId == expectedUserID else {
                accountDeletionState = .failed("The server account was deleted, but the active device identity changed before local cleanup. Sign out to remove this device's local data.")
                return false
            }

            await onSuccess()
            accountDeletionState = .succeeded
            return true
        } catch {
            accountDeletionState = .failed(AccountDeletionMessages.message(for: error))
            return false
        }
    }

    func resetAccountDeletionState() {
        guard accountDeletionState != .deleting else { return }
        accountDeletionState = .idle
    }
}
