import Foundation
import Observation
import Supabase

@MainActor
@Observable
final class ConversationStore {
    private struct Snapshot: Codable {
        var conversations: [AgentConversation] = []
        var events: [AgentEvent] = []
        var commands: [AgentCommand] = []
        var pending: Set<UUID> = []
        var newConversations: Set<UUID> = []
        var selected: UUID?
    }

    private var snapshot = Snapshot()
    private var owner: UUID?
    private let transport: any ConversationTransport
    private let directory: URL
    private var generation = UUID()
    private var refreshing = false
    private(set) var runners: [AgentRunner] = []
    private(set) var issue: String?
    private(set) var isRefreshing = false
    private(set) var lastChecked: Date?
    private(set) var connected = false
    var draftFromVoice: String?

    init(transport: any ConversationTransport, directory: URL? = nil) {
        self.transport = transport
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FieldTheory/Conversations", isDirectory: true)
    }

    var conversations: [AgentConversation] {
        snapshot.conversations.sorted { $0.updated_at > $1.updated_at }
    }
    var selectedID: UUID? { snapshot.selected }
    var selected: AgentConversation? { conversations.first { $0.id == selectedID } }
    var events: [AgentEvent] {
        snapshot.events.filter { $0.conversation_id == selectedID }.sorted { $0.seq < $1.seq }
    }
    /// An accepted command remains visible until its durable user event arrives.
    var unechoedCommands: [AgentCommand] {
        let echoed = Set(events.filter { $0.kind == "user" }.compactMap(\.command_id))
        return snapshot.commands.filter { $0.conversation_id == selectedID && !echoed.contains($0.id) }
    }
    var pendingCount: Int { snapshot.pending.count }
    func isPending(_ id: UUID) -> Bool { snapshot.pending.contains(id) }
    var onlineRunners: [AgentRunner] { runners.filter(\.isOnline) }
    var availableProviders: [AgentRunner.Provider] {
        var seen = Set<String>()
        return onlineRunners.flatMap { $0.capabilities.providers }.filter {
            $0.available && $0.signed_in == true && seen.insert($0.id).inserted
        }
    }

    func configure(owner nextOwner: UUID?, connected: Bool) {
        self.connected = connected
        guard owner != nextOwner else { return }
        generation = UUID()
        owner = nextOwner
        snapshot = Snapshot()
        runners = []
        issue = nil
        lastChecked = nil
        draftFromVoice = nil
        if let url = cacheURL, FileManager.default.fileExists(atPath: url.path) {
            do {
                snapshot = try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: url))
                // A cache is never authorization for a different account.
                guard snapshot.conversations.allSatisfy({ $0.user_id == nextOwner }),
                      snapshot.commands.allSatisfy({ $0.user_id == nextOwner }),
                      snapshot.events.allSatisfy({ $0.user_id == nextOwner }) else {
                    snapshot = Snapshot()
                    issue = "This phone’s saved conversation belongs to another account."
                    return
                }
            } catch {
                issue = "Could not read saved conversations. \(error.localizedDescription)"
            }
        }
    }

    func select(_ id: UUID?) {
        snapshot.selected = id
        persistOrReport()
    }

    /// Returns success only after durable local storage. Network success is a
    /// separate state, so closing the app during a send cannot lose its UUID.
    @discardableResult
    func enqueue(text: String, provider: String? = nil, model: String? = nil) -> Bool {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let owner, !text.isEmpty, text.count <= 120_000 else { return false }
        let before = snapshot
        let now = ISO8601DateFormatter().string(from: Date())
        if snapshot.selected == nil {
            guard let provider, availableProviders.contains(where: { $0.id == provider }) else {
                issue = "Connect an available, signed-in Mac runner before starting a conversation."
                return false
            }
            let conversation = AgentConversation(id: UUID(), user_id: owner, title: String(text.prefix(80)),
                provider: provider, model: model, status: "queued", created_at: now, updated_at: now)
            snapshot.conversations.insert(conversation, at: 0)
            snapshot.newConversations.insert(conversation.id)
            snapshot.selected = conversation.id
        }
        guard let conversation = snapshot.selected else { return false }
        let command = AgentCommand(id: UUID(), user_id: owner, conversation_id: conversation, text: text,
            status: "queued", created_at: now, updated_at: now)
        snapshot.commands.append(command)
        snapshot.pending.insert(command.id)
        do {
            try persist()
            issue = nil
            return true
        } catch {
            snapshot = before
            issue = "Message could not be saved on this phone. \(error.localizedDescription)"
            return false
        }
    }

    /// Each pass is serialized. Background cancellation leaves the outbox
    /// untouched, and the next foreground pass retries the same command IDs.
    func refresh() async {
        guard let owner, connected, !refreshing else { return }
        refreshing = true
        isRefreshing = true
        let token = generation
        defer { refreshing = false; isRefreshing = false }
        do {
            let fetchedRunners = try await transport.runners(owner: owner)
            guard generation == token else { return }
            runners = fetchedRunners
            let remote = try await transport.conversations(owner: owner)
            guard generation == token else { return }
            let pendingConversations = Set(snapshot.commands.filter { snapshot.pending.contains($0.id) }.map(\.conversation_id))
            let localOnly = snapshot.conversations.filter {
                snapshot.newConversations.contains($0.id) || $0.id == snapshot.selected || pendingConversations.contains($0.id)
            }
            snapshot.conversations = remote + localOnly.filter { local in !remote.contains { $0.id == local.id } }
            for conversation in snapshot.conversations where snapshot.newConversations.contains(conversation.id) {
                try Task.checkCancellation()
                try await transport.create(conversation)
                guard generation == token else { return }
                snapshot.newConversations.remove(conversation.id)
                try persist()
            }
            for command in snapshot.commands where snapshot.pending.contains(command.id) {
                try Task.checkCancellation()
                try await transport.send(command)
                guard generation == token else { return }
                snapshot.pending.remove(command.id)
                try persist()
            }
            let selection = selectedID
            if let selection {
                // Bound each foreground pass; busy streams continue next pass.
                for _ in 0..<5 {
                    try Task.checkCancellation()
                    let cursor = snapshot.events.filter { $0.conversation_id == selection }.map(\.seq).max() ?? 0
                    let page = try await transport.events(owner: owner, conversation: selection, after: cursor)
                    guard generation == token else { return }
                    let known = Set(snapshot.events.map(\.id))
                    snapshot.events.append(contentsOf: page.filter { !known.contains($0.id) })
                    let echoed = Set(page.filter { $0.kind == "user" }.compactMap(\.command_id))
                    let pending = snapshot.pending
                    snapshot.commands.removeAll { echoed.contains($0.id) && !pending.contains($0.id) }
                    try persist()
                    if page.count < 200 { break }
                }
            }
            issue = nil
            lastChecked = Date()
        } catch is CancellationError {
            // Suspension is expected; the saved cursor and outbox survive.
        } catch {
            guard generation == token else { return }
            if let error = error as? PostgrestError, ["42P01", "PGRST205", "PGRST204"].contains(error.code ?? "") {
                issue = "Conversations are not available on this server yet. The relay migration must be installed. Your saved history and pending messages remain on this phone."
            } else if let error = error as? PostgrestError, error.code == "42501" {
                issue = "This account cannot access the conversation relay. Sign in again or check the server’s access policy."
            } else {
                issue = "Could not connect to conversations. \(error.localizedDescription) Pending messages remain on this phone."
            }
        }
    }

    func forget() {
        if let url = cacheURL {
            do { try FileManager.default.removeItem(at: url) }
            catch { if FileManager.default.fileExists(atPath: url.path) { issue = error.localizedDescription } }
        }
        configure(owner: nil, connected: false)
    }

    private var cacheURL: URL? { owner.map { directory.appendingPathComponent($0.uuidString + ".json") } }
    private func persist() throws {
        guard let url = cacheURL else { return }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(snapshot).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    private func persistOrReport() {
        do { try persist() }
        catch { issue = "Could not save conversation history. \(error.localizedDescription)" }
    }
}
