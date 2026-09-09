import Foundation

// MARK: - Goals feed

enum GoalProject: String, CaseIterable, Identifiable {
    case fieldtheoryLabs = "fieldtheory-labs"
    case fieldtheory = "fieldtheory"
    case fieldtheoryCli = "fieldtheory-cli"

    var id: String { rawValue }
    var displayName: String { rawValue }
}

struct GoalCard: Codable, Identifiable, Hashable {
    struct Source: Codable, Hashable {
        var tweetId: String
        var url: String
        var authorHandle: String?
        var authorName: String?
        var postedAt: String?
        var excerpt: String
    }

    /// The eight scoring axes from the Algorithm brief, each 0...1.
    /// `cost` reads inverted: higher means more expensive to pursue.
    struct Scores: Codable, Hashable {
        var relevance: Double
        var actionability: Double
        var novelty: Double
        var leverage: Double
        var timing: Double
        var evidence: Double
        var confidence: Double
        var cost: Double
    }

    var id: String
    var project: String
    var algorithmVersion: String
    var source: Source
    var title: String
    var whyNow: String
    var goal: String
    var firstTest: String
    var scores: Scores
    var scoreNote: String
    var composite: Double
}

struct GoalCardSet: Codable {
    var algorithmVersion: String
    var generatedAt: String
    var cards: [GoalCard]
}

// MARK: - Feedback

enum GoalFeedbackAction: String {
    case useful
    case notUseful = "not_useful"
    case pursued
}

struct GoalFeedback: Identifiable, Hashable {
    var id: String
    var cardId: String
    var algorithmVersion: String
    var project: String
    var action: String
    var context: String?
    var createdAtMs: Int64
}
