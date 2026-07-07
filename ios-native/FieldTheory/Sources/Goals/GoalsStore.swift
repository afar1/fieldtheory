import Foundation
import Observation

@MainActor
@Observable
final class GoalsStore {
    private let db: Database
    private let cardsURL: URL?

    private(set) var cards: [GoalCard] = []
    private(set) var feedback: [GoalFeedback] = []

    var algorithmVersion: String = "v0.1"

    init(db: Database, cardsURL: URL? = nil) {
        self.db = db
        self.cardsURL = cardsURL
        loadCards()
    }

    func reload() async {
        loadCards()
        do {
            let rows = try await db.query("SELECT * FROM goal_feedback ORDER BY created_at_ms DESC, id DESC")
            feedback = rows.map(Self.feedbackFromRow)
        } catch {
            feedback = []
        }
    }

    var judgedCardIds: Set<String> {
        Set(feedback.filter { $0.action == GoalFeedbackAction.useful.rawValue || $0.action == GoalFeedbackAction.notUseful.rawValue }.map(\.cardId))
    }

    var pursuedCardIds: Set<String> {
        Set(feedback.filter { $0.action == GoalFeedbackAction.pursued.rawValue }.map(\.cardId))
    }

    func cards(for project: GoalProject?) -> [GoalCard] {
        let filtered = project.map { target in cards.filter { $0.project == target.rawValue } } ?? cards
        return filtered.sorted { $0.composite > $1.composite }
    }

    func unjudgedCards(for project: GoalProject?) -> [GoalCard] {
        let judged = judgedCardIds
        return cards(for: project).filter { !judged.contains($0.id) }
    }

    @discardableResult
    func record(card: GoalCard, action: GoalFeedbackAction, context: String? = nil) async -> GoalFeedback {
        let now = Timestamps.nowMs()
        let normalizedContext = context?.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedContext = normalizedContext?.isEmpty == true ? nil : normalizedContext
        let entry = GoalFeedback(
            id: "\(now)-\(String(UUID().uuidString.prefix(8)))",
            cardId: card.id,
            algorithmVersion: card.algorithmVersion,
            project: card.project,
            action: action.rawValue,
            context: trimmedContext,
            createdAtMs: now
        )
        try? await db.run("""
            INSERT INTO goal_feedback (id, card_id, algorithm_version, project, action, context, created_at_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, [
                .text(entry.id),
                .text(entry.cardId),
                .text(entry.algorithmVersion),
                .text(entry.project),
                .text(entry.action),
                trimmedContext.map(SQLValue.text) ?? .null,
                .int(now),
            ])
        await reload()
        return entry
    }

    func exportFeedbackJSON() -> String {
        guard !feedback.isEmpty else { return "[]" }
        let rows = feedback.map(ExportRow.init)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(rows),
              let json = String(data: data, encoding: .utf8) else { return "[]" }
        return json
    }

    private func loadCards() {
        let url = cardsURL ?? Bundle.main.url(forResource: "goals-cards", withExtension: "json")
        guard let url,
              let data = try? Data(contentsOf: url),
              let set = try? JSONDecoder().decode(GoalCardSet.self, from: data) else {
            cards = []
            return
        }
        cards = set.cards
        algorithmVersion = set.algorithmVersion
    }

    private static func feedbackFromRow(_ row: [String: SQLValue]) -> GoalFeedback {
        GoalFeedback(
            id: row["id"]?.stringValue ?? "",
            cardId: row["card_id"]?.stringValue ?? "",
            algorithmVersion: row["algorithm_version"]?.stringValue ?? "",
            project: row["project"]?.stringValue ?? "",
            action: row["action"]?.stringValue ?? "",
            context: row["context"]?.stringValue,
            createdAtMs: row["created_at_ms"]?.intValue ?? 0
        )
    }

    private struct ExportRow: Encodable {
        var id: String
        var cardId: String
        var algorithmVersion: String
        var project: String
        var action: String
        var context: String?
        var createdAtMs: Int64

        init(_ entry: GoalFeedback) {
            id = entry.id
            cardId = entry.cardId
            algorithmVersion = entry.algorithmVersion
            project = entry.project
            action = entry.action
            context = entry.context
            createdAtMs = entry.createdAtMs
        }

        enum CodingKeys: String, CodingKey {
            case id
            case cardId = "card_id"
            case algorithmVersion = "algorithm_version"
            case project
            case action
            case context
            case createdAtMs = "created_at_ms"
        }
    }
}
