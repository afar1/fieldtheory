import XCTest
import Supabase
@testable import FieldTheory

@MainActor
final class AccountDeletionFlowTests: XCTestCase {
    private let userID = UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
    private let otherUserID = UUID(uuidString: "22222222-2222-2222-2222-222222222222")!

    func testReviewerDemoAndSignedOutStateCannotRequestDeletion() async {
        var requestCount = 0
        let demo = makeStore(
            phase: .signedIn(userId: userID, email: "reviewer@example.com"),
            sessionUserID: userID
        ) { _ in
            requestCount += 1
            return true
        }
        demo.beginReviewerDemo()

        let demoResult = await demo.deleteAccount()
        XCTAssertFalse(demoResult)
        XCTAssertEqual(requestCount, 0)

        let signedOut = makeStore(phase: .signedOut, sessionUserID: userID) { _ in
            requestCount += 1
            return true
        }
        let signedOutResult = await signedOut.deleteAccount()
        XCTAssertFalse(signedOutResult)
        XCTAssertEqual(requestCount, 0)
    }

    func testSessionIdentityMismatchCannotRequestDeletion() async {
        var requestCount = 0
        let store = makeStore(
            phase: .signedIn(userId: userID, email: "reviewer@example.com"),
            sessionUserID: otherUserID
        ) { _ in
            requestCount += 1
            return true
        }

        let result = await store.deleteAccount()
        XCTAssertFalse(result)
        XCTAssertEqual(requestCount, 0)
        XCTAssertEqual(
            store.accountDeletionError,
            "The active session changed. Sign in again before deleting your account."
        )
    }

    func testHTTPFailureDoesNotRunLocalCleanup() async throws {
        var cleanupCount = 0
        let body = try XCTUnwrap("""
            {"error":"Account deletion did not finish after associated data cleanup.","code":"account_delete_failed"}
            """.data(using: .utf8))
        let store = makeStore(
            phase: .signedIn(userId: userID, email: "reviewer@example.com"),
            sessionUserID: userID
        ) { _ in
            throw FunctionsError.httpError(code: 500, data: body)
        }

        let result = await store.deleteAccount {
            cleanupCount += 1
        }

        XCTAssertFalse(result)
        XCTAssertEqual(cleanupCount, 0)
        XCTAssertEqual(
            store.accountDeletionError,
            "Account deletion did not finish after associated data cleanup."
        )
    }

    func testFalseSuccessResponseDoesNotRunLocalCleanup() async {
        var cleanupCount = 0
        let store = makeStore(
            phase: .signedIn(userId: userID, email: "reviewer@example.com"),
            sessionUserID: userID
        ) { _ in false }

        let result = await store.deleteAccount {
            cleanupCount += 1
        }

        XCTAssertFalse(result)
        XCTAssertEqual(cleanupCount, 0)
        XCTAssertNotNil(store.accountDeletionError)
    }

    func testSuccessfulReplyRunsCleanupAndReturnsTrue() async {
        var requestedToken: String?
        var cleanupCount = 0
        let store = makeStore(
            phase: .signedIn(userId: userID, email: "reviewer@example.com"),
            sessionUserID: userID
        ) { token in
            requestedToken = token
            return true
        }

        let result = await store.deleteAccount {
            cleanupCount += 1
        }

        XCTAssertTrue(result)
        XCTAssertEqual(requestedToken, "test-access-token")
        XCTAssertEqual(cleanupCount, 1)
        XCTAssertEqual(store.accountDeletionState, .succeeded)
    }

    func testIdentityChangeAfterSuccessfulReplyDoesNotRunLocalCleanup() async {
        var cleanupCount = 0
        var store: AuthStore!
        store = makeStore(
            phase: .signedIn(userId: userID, email: "reviewer@example.com"),
            sessionUserID: userID
        ) { _ in
            store.clearIdentity()
            return true
        }

        let result = await store.deleteAccount {
            cleanupCount += 1
        }

        XCTAssertFalse(result)
        XCTAssertEqual(cleanupCount, 0)
        XCTAssertEqual(
            store.accountDeletionError,
            "The server account was deleted, but the active device identity changed before local cleanup. Sign out to remove this device's local data."
        )
    }

    private func makeStore(
        phase: AuthPhase,
        sessionUserID: UUID,
        request: @escaping AccountDeletionRequester
    ) -> AuthStore {
        let suiteName = "AccountDeletionFlowTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        if case .signedIn(let userID, let email) = phase {
            defaults.set(userID.uuidString, forKey: "ft-user-id")
            defaults.set(email, forKey: "ft-user-email")
        }

        return AuthStore(
            client: SupabaseConfig.makeClient(),
            defaults: defaults,
            initialPhase: phase,
            observeAuthChanges: false,
            accountDeletionSession: {
                AccountDeletionSession(userID: sessionUserID, accessToken: "test-access-token")
            },
            accountDeletionRequest: request
        )
    }
}
