import XCTest
@testable import FieldTheory

final class ReviewerAccessTests: XCTestCase {
    func testDeletionConfirmationRequiresTheAccountEmail() {
        XCTAssertTrue(AccountDeletionConfirmation.matches(
            "  Reviewer@Example.com\n",
            accountEmail: "reviewer@example.com"
        ))
        XCTAssertFalse(AccountDeletionConfirmation.matches(
            "someone-else@example.com",
            accountEmail: "reviewer@example.com"
        ))
        XCTAssertFalse(AccountDeletionConfirmation.matches("", accountEmail: nil))
    }

    func testDeletionErrorUsesTheBackendFailureInsteadOfClaimingSuccess() throws {
        let data = try XCTUnwrap("""
            {"error":"Account deletion did not finish because stored files could not all be removed.","code":"storage_cleanup_failed"}
            """.data(using: .utf8))

        XCTAssertEqual(
            AccountDeletionMessages.message(statusCode: 502, data: data),
            "Account deletion did not finish because stored files could not all be removed."
        )
    }

    func testDeletionErrorHasUsefulSessionAndServiceFallbacks() {
        XCTAssertEqual(
            AccountDeletionMessages.message(statusCode: 401, data: Data()),
            "Your session expired. Sign out, sign in again, and retry account deletion."
        )
        XCTAssertEqual(
            AccountDeletionMessages.message(statusCode: 404, data: Data()),
            "Account deletion is unavailable right now. Contact support for help."
        )
    }

    func testReviewerFixturesUseClearlyDemoScopedIdentifiers() {
        XCTAssertGreaterThanOrEqual(ReviewerDemoFixtures.voiceSamples.count, 2)
        XCTAssertTrue(ReviewerDemoFixtures.voiceSamples.allSatisfy {
            $0.id.hasPrefix("reviewer-demo-") && !$0.text.isEmpty
        })

        let identifiers = ReviewerDemoFixtures.voiceSamples.map(\.id)
        XCTAssertEqual(Set(identifiers).count, identifiers.count)
    }
}
