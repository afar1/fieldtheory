import Foundation
import Supabase

struct AgentConversation: Codable, Identifiable, Equatable {
    let id: UUID
    let user_id: UUID
    var title: String
    let provider: String
    let model: String?
    var status: String
    var created_at: String
    var updated_at: String
}

struct AgentCommand: Codable, Identifiable, Equatable {
    let id: UUID
    let user_id: UUID
    let conversation_id: UUID
    let text: String
    var status: String
    var created_at: String
    var updated_at: String
}

struct AgentEvent: Codable, Identifiable, Equatable {
    let seq: Int64
    let id: UUID
    let user_id: UUID
    let conversation_id: UUID
    let command_id: UUID?
    let kind: String
    let text: String
    let created_at: String
    // Decode only displayable linkage. Provider payloads can gain fields
    // without invalidating the persisted timeline.
    var payload: Payload?

    struct Payload: Codable, Equatable {
        var run_id: String?
        var parent_run_id: String?
        var status: String?
        var provider: String?
    }
}

struct AgentRunner: Decodable, Identifiable {
    let id: String
    let updated_at: String
    let capabilities: Capabilities
    struct Capabilities: Decodable {
        let schema_version: Int
        let providers: [Provider]
    }
    struct Provider: Decodable, Identifiable {
        let id: String
        let label: String
        let available: Bool
        let signed_in: Bool?
        let models: [Model]
        let message: String?
        struct Model: Decodable, Identifiable {
            let id: String
            let label: String
        }
    }
    var isOnline: Bool {
        let age = Date().timeIntervalSince1970 - Double(Timestamps.ms(fromISO: updated_at)) / 1000
        return capabilities.schema_version == 1 && age >= -30 && age < 90
    }
}

@MainActor
protocol ConversationTransport {
    func conversations(owner: UUID) async throws -> [AgentConversation]
    func events(owner: UUID, conversation: UUID, after: Int64) async throws -> [AgentEvent]
    func runners(owner: UUID) async throws -> [AgentRunner]
    func create(_ conversation: AgentConversation) async throws
    func send(_ command: AgentCommand) async throws
}

enum ConversationFailure: LocalizedError {
    case identityConflict
    var errorDescription: String? { "A saved message ID has different contents on the server. Your message was kept on this phone; it was not resent." }
}

@MainActor
final class SupabaseConversationTransport: ConversationTransport {
    private let client: SupabaseClient
    init(client: SupabaseClient) { self.client = client }

    func conversations(owner: UUID) async throws -> [AgentConversation] {
        try await client.from("ft_agent_conversations").select()
            .eq("user_id", value: owner.uuidString).order("updated_at", ascending: false).limit(50).execute().value
    }

    func events(owner: UUID, conversation: UUID, after: Int64) async throws -> [AgentEvent] {
        try await client.from("ft_agent_events").select()
            .eq("user_id", value: owner.uuidString).eq("conversation_id", value: conversation.uuidString)
            .gt("seq", value: String(after)).order("seq", ascending: true).limit(200).execute().value
    }

    func runners(owner: UUID) async throws -> [AgentRunner] {
        try await client.from("ft_agent_runners").select()
            .eq("user_id", value: owner.uuidString).order("updated_at", ascending: false).limit(20).execute().value
    }

    func create(_ conversation: AgentConversation) async throws {
        struct Insert: Encodable {
            let id: UUID; let user_id: UUID; let title: String; let provider: String; let model: String?
        }
        do {
            try await client.from("ft_agent_conversations").insert(Insert(
                id: conversation.id, user_id: conversation.user_id, title: conversation.title,
                provider: conversation.provider, model: conversation.model)).execute()
        } catch let error as PostgrestError where error.code == "23505" {
            let existing: AgentConversation = try await client.from("ft_agent_conversations").select()
                .eq("id", value: conversation.id.uuidString).eq("user_id", value: conversation.user_id.uuidString)
                .single().execute().value
            guard existing.provider == conversation.provider, existing.model == conversation.model,
                  existing.title == conversation.title else { throw ConversationFailure.identityConflict }
        }
    }

    func send(_ command: AgentCommand) async throws {
        struct Insert: Encodable {
            let id: UUID; let user_id: UUID; let conversation_id: UUID; let text: String
        }
        do {
            try await client.from("ft_agent_commands").insert(Insert(id: command.id, user_id: command.user_id,
                conversation_id: command.conversation_id, text: command.text)).execute()
        } catch let error as PostgrestError where error.code == "23505" {
            let existing: AgentCommand = try await client.from("ft_agent_commands").select()
                .eq("id", value: command.id.uuidString).eq("user_id", value: command.user_id.uuidString)
                .single().execute().value
            guard existing.conversation_id == command.conversation_id, existing.text == command.text else {
                throw ConversationFailure.identityConflict
            }
        }
    }
}
