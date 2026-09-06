import XCTest
@testable import FieldTheory

@MainActor
final class GoalsTests: XCTestCase {
    /// Fixture matching the generator's goals-cards.json contract: two
    /// fieldtheory cards (out of composite order) plus one CLI card.
    private let fixtureJSON = """
    {
      "algorithmVersion": "v0.9-test",
      "generatedAt": "2026-07-07T00:00:00Z",
      "cards": [
        {
          "id": "card-low",
          "project": "fieldtheory",
          "algorithmVersion": "v0.9-test",
          "source": {
            "tweetId": "111",
            "url": "https://x.com/a/status/111",
            "authorHandle": "alpha",
            "authorName": "Alpha",
            "postedAt": "2026-07-01T00:00:00Z",
            "excerpt": "low idea"
          },
          "title": "Low card",
          "whyNow": "because",
          "goal": "do the small thing",
          "firstTest": "try it small",
          "scores": {
            "relevance": 0.4,
            "actionability": 0.3,
            "novelty": 0.2,
            "leverage": 0.3,
            "timing": 0.5,
            "evidence": 0.4,
            "confidence": 0.6,
            "cost": 0.7
          },
          "scoreNote": "meh",
          "composite": 0.31
        },
        {
          "id": "card-high",
          "project": "fieldtheory",
          "algorithmVersion": "v0.9-test",
          "source": {
            "tweetId": "222",
            "url": "https://x.com/b/status/222",
            "authorHandle": "bravo",
            "authorName": "Bravo",
            "postedAt": "2026-07-02T00:00:00Z",
            "excerpt": "high idea"
          },
          "title": "High card",
          "whyNow": "timely",
          "goal": "do the big thing",
          "firstTest": "spike it",
          "scores": {
            "relevance": 0.9,
            "actionability": 0.8,
            "novelty": 0.7,
            "leverage": 0.9,
            "timing": 0.8,
            "evidence": 0.7,
            "confidence": 0.8,
            "cost": 0.2
          },
          "scoreNote": "strong",
          "composite": 0.87
        },
        {
          "id": "card-cli",
          "project": "fieldtheory-cli",
          "algorithmVersion": "v0.9-test",
          "source": {
            "tweetId": "333",
            "url": "https://x.com/c/status/333",
            "authorHandle": null,
            "authorName": null,
            "postedAt": null,
            "excerpt": "cli idea"
          },
          "title": "CLI card",
          "whyNow": "cli momentum",
          "goal": "ship a flag",
          "firstTest": "add the flag",
          "scores": {
            "relevance": 0.6,
            "actionability": 0.9,
            "novelty": 0.4,
            "leverage": 0.5,
            "timing": 0.6,
            "evidence": 0.5,
            "confidence": 0.7,
            "cost": 0.3
          },
          "scoreNote": "quick win",
          "composite": 0.55
        }
      ]
    }
    """

    private func makeStore() throws -> (store: GoalsStore, dbPath: String, cardsURL: URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ft-goals-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let cardsURL = dir.appendingPathComponent("goals-cards.json")
        try fixtureJSON.write(to: cardsURL, atomically: true, encoding: .utf8)
        let dbPath = dir.appendingPathComponent("test.sqlite").path
        let db = try Database(path: dbPath)
        return (GoalsStore(db: db, cardsURL: cardsURL), dbPath, cardsURL)
    }

    func testDecodesGoalCardSet() throws {
        let data = try XCTUnwrap(fixtureJSON.data(using: .utf8))
        let set = try JSONDecoder().decode(GoalCardSet.self, from: data)

        XCTAssertEqual(set.algorithmVersion, "v0.9-test")
        XCTAssertEqual(set.cards.count, 3)

        let high = try XCTUnwrap(set.cards.first { $0.id == "card-high" })
        XCTAssertEqual(high.project, "fieldtheory")
        XCTAssertEqual(high.source.tweetId, "222")
        XCTAssertEqual(high.source.authorHandle, "bravo")
        XCTAssertEqual(high.scores.relevance, 0.9)
        XCTAssertEqual(high.scores.cost, 0.2)
        XCTAssertEqual(high.composite, 0.87)
        XCTAssertEqual(high.firstTest, "spike it")

        let cli = try XCTUnwrap(set.cards.first { $0.id == "card-cli" })
        XCTAssertNil(cli.source.authorHandle)
    }

    func testRecordPersistsFeedback() async throws {
        let (store, dbPath, cardsURL) = try makeStore()
        await store.reload()
        XCTAssertEqual(store.cards.count, 3)
        let card = try XCTUnwrap(store.cards.first { $0.id == "card-high" })

        await store.record(card: card, action: .useful)
        await store.record(card: card, action: .pursued, context: "  try it\n")

        XCTAssertEqual(store.feedback.count, 2)
        XCTAssertTrue(store.judgedCardIds.contains(card.id))
        XCTAssertTrue(store.pursuedCardIds.contains(card.id))
        XCTAssertFalse(store.judgedCardIds.contains("card-low"))
        XCTAssertFalse(store.pursuedCardIds.contains("card-low"))
        let pursued = try XCTUnwrap(store.feedback.first { $0.action == "pursued" })
        XCTAssertEqual(pursued.context, "try it")

        // Persistence: a fresh store over the same db file sees the rows.
        let reopened = GoalsStore(db: try Database(path: dbPath), cardsURL: cardsURL)
        await reopened.reload()
        XCTAssertEqual(reopened.feedback.count, 2)
        XCTAssertTrue(reopened.judgedCardIds.contains(card.id))
        XCTAssertTrue(reopened.pursuedCardIds.contains(card.id))
    }

    func testCardsForProjectFiltersAndSorts() async throws {
        let (store, _, _) = try makeStore()
        await store.reload()

        let fieldtheory = store.cards(for: .fieldtheory)
        XCTAssertEqual(fieldtheory.map(\.id), ["card-high", "card-low"])

        let cli = store.cards(for: .fieldtheoryCli)
        XCTAssertEqual(cli.map(\.id), ["card-cli"])

        let all = store.cards(for: nil)
        XCTAssertEqual(all.map(\.id), ["card-high", "card-cli", "card-low"])
    }

    func testUnjudgedCardsExcludeUsefulAndNotUsefulOnly() async throws {
        let (store, _, _) = try makeStore()
        await store.reload()
        let high = try XCTUnwrap(store.cards.first { $0.id == "card-high" })
        let low = try XCTUnwrap(store.cards.first { $0.id == "card-low" })

        await store.record(card: high, action: .pursued)
        XCTAssertEqual(store.unjudgedCards(for: .fieldtheory).map(\.id), ["card-high", "card-low"])

        await store.record(card: high, action: .useful)
        XCTAssertEqual(store.unjudgedCards(for: .fieldtheory).map(\.id), ["card-low"])

        await store.record(card: low, action: .notUseful)
        XCTAssertTrue(store.unjudgedCards(for: .fieldtheory).isEmpty)
    }

    func testExportFeedbackJSON() async throws {
        let (store, _, _) = try makeStore()
        await store.reload()
        XCTAssertEqual(store.exportFeedbackJSON(), "[]")

        let card = try XCTUnwrap(store.cards.first { $0.id == "card-cli" })
        await store.record(card: card, action: .notUseful, context: "off target")

        let json = store.exportFeedbackJSON()
        XCTAssertTrue(json.contains("card_id"))
        XCTAssertTrue(json.contains("v0.9-test"))

        let data = try XCTUnwrap(json.data(using: .utf8))
        let parsed = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        XCTAssertEqual(parsed.count, 1)
        XCTAssertEqual(parsed[0]["action"] as? String, "not_useful")
        XCTAssertEqual(parsed[0]["context"] as? String, "off target")
    }
}
