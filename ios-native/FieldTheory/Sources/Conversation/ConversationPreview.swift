#if targetEnvironment(simulator)
import Foundation

/// Local-only relay for native UI acceptance. Never compiled into device apps.
@MainActor
final class ConversationPreview: ConversationTransport {
    static let owner = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
    static let conversationID = UUID(uuidString: "00000000-0000-0000-0000-000000000002")!
    private let conversation: AgentConversation
    private var timeline: [AgentEvent]
    private var accepted = Set<UUID>()
    init() {
        let now = ISO8601DateFormatter().string(from: Date())
        conversation = AgentConversation(id: Self.conversationID, user_id: Self.owner,
            title: "Plan the mobile conversation", provider: "codex", model: nil,
            status: "completed", created_at: now, updated_at: now)
        timeline = [
            AgentEvent(seq: 1, id: UUID(), user_id: Self.owner, conversation_id: Self.conversationID,
                command_id: nil, kind: "user", text: "Plan the native iPhone conversation experience.", created_at: now),
            AgentEvent(seq: 2, id: UUID(), user_id: Self.owner, conversation_id: Self.conversationID,
                command_id: nil, kind: "delegation", text: "Research agent reviewed authentication and reconnect behavior.",
                created_at: now, payload: .init(run_id: "research", parent_run_id: "orchestrator", status: "completed", provider: "claude")),
            AgentEvent(seq: 3, id: UUID(), user_id: Self.owner, conversation_id: Self.conversationID,
                command_id: nil, kind: "assistant", text: "The plan is ready. Use native navigation, durable history and one orchestrator for follow-ups.", created_at: now)
        ]
    }
    func conversations(owner: UUID) async throws -> [AgentConversation] { [conversation] }
    func events(owner: UUID, conversation: UUID, after: Int64) async throws -> [AgentEvent] {
        timeline.filter { $0.conversation_id == conversation && $0.seq > after }
    }
    func runners(owner: UUID) async throws -> [AgentRunner] {
        [.init(id: "sample-mac", updated_at: ISO8601DateFormatter().string(from: Date()),
            capabilities: .init(schema_version: 1, providers: [.init(id: "codex", label: "Codex", available: true,
                signed_in: true, models: [], message: nil)]))]
    }
    func create(_ conversation: AgentConversation) async throws { }
    func send(_ command: AgentCommand) async throws {
        guard accepted.insert(command.id).inserted else { return }
        let now = ISO8601DateFormatter().string(from: Date())
        timeline.append(.init(seq: Int64(timeline.count + 1), id: command.id, user_id: command.user_id,
            conversation_id: command.conversation_id, command_id: command.id, kind: "user", text: command.text, created_at: now))
        timeline.append(.init(seq: Int64(timeline.count + 1), id: UUID(), user_id: command.user_id,
            conversation_id: command.conversation_id, command_id: command.id, kind: "assistant",
            text: "Sample reply: your follow-up stayed in this orchestrator conversation.", created_at: now))
    }
}
#endif
