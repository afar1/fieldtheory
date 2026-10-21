import XCTest
import Supabase
@testable import FieldTheory

@MainActor
final class ConversationStoreTests: XCTestCase {
    private var directory: URL!
    override func setUp() {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }
    override func tearDown() { try? FileManager.default.removeItem(at: directory) }

    func testLostSendAcknowledgementSurvivesRestartWithoutDuplicatingMessage() async throws {
        let relay = Relay()
        let first = ConversationStore(transport: relay, directory: directory)
        first.configure(owner: relay.owner, connected: true)
        await first.refresh()
        XCTAssertTrue(first.enqueue(text: "Research native controls", provider: "codex"))
        relay.loseAcknowledgement = true
        await first.refresh()
        XCTAssertEqual(first.pendingCount, 1)
        XCTAssertNotNil(first.issue)
        let commandID = try XCTUnwrap(relay.commands.first?.id)

        let relaunched = ConversationStore(transport: relay, directory: directory)
        relaunched.configure(owner: relay.owner, connected: true)
        XCTAssertEqual(relaunched.pendingCount, 1)
        await relaunched.refresh()
        XCTAssertEqual(relay.commands.map(\.id), [commandID])
        XCTAssertEqual(relaunched.pendingCount, 0)
        XCTAssertEqual(relaunched.events.filter { $0.kind == "user" }.count, 1)
        XCTAssertTrue(relaunched.unechoedCommands.isEmpty)
        XCTAssertTrue(relaunched.enqueue(text: "Continue in the same thread"))
        await relaunched.refresh()
        XCTAssertEqual(Set(relay.commands.map(\.conversation_id)).count, 1)
        XCTAssertEqual(relaunched.events.filter { $0.kind == "user" }.count, 2)
    }

    func testHistoryCatchesUpAcrossPagesAndDoesNotReplayOnReconnect() async throws {
        let relay = Relay()
        let store = ConversationStore(transport: relay, directory: directory)
        store.configure(owner: relay.owner, connected: true)
        await store.refresh()
        XCTAssertTrue(store.enqueue(text: "Run research", provider: "codex"))
        await store.refresh()
        let conversation = try XCTUnwrap(store.selectedID)
        relay.timeline += (2...205).map { index in
            AgentEvent(seq: Int64(index), id: UUID(), user_id: relay.owner, conversation_id: conversation,
                command_id: nil, kind: index == 205 ? "assistant" : "delegation", text: "Update \(index)", created_at: relay.now)
        }
        await store.refresh()
        XCTAssertEqual(store.events.count, 205)
        let restart = ConversationStore(transport: relay, directory: directory)
        restart.configure(owner: relay.owner, connected: true)
        await restart.refresh()
        XCTAssertEqual(restart.events.count, 205)
        XCTAssertEqual(relay.cursors.suffix(3), [1, 201, 205])
        restart.configure(owner: UUID(), connected: false)
        XCTAssertTrue(restart.events.isEmpty)
        XCTAssertTrue(restart.conversations.isEmpty)
        XCTAssertEqual(restart.pendingCount, 0)
    }

    func testFailedHistoryReadIsNotReportedAsSuccessfulEmptyHistory() async {
        let relay = Relay()
        relay.failHistory = true
        let store = ConversationStore(transport: relay, directory: directory)
        store.configure(owner: relay.owner, connected: true)
        await store.refresh()
        XCTAssertNotNil(store.issue)
        XCTAssertTrue(store.issue?.contains("relay migration") == true)
        XCTAssertNil(store.lastChecked)
    }

    private final class Relay: ConversationTransport {
        let owner = UUID()
        var now: String { ISO8601DateFormatter().string(from: Date()) }
        var saved: [AgentConversation] = []
        var commands: [AgentCommand] = []
        var timeline: [AgentEvent] = []
        var cursors: [Int64] = []
        var loseAcknowledgement = false
        var failHistory = false
        func runners(owner: UUID) async throws -> [AgentRunner] {
            [AgentRunner(id: "mac", updated_at: now, capabilities: .init(schema_version: 1,
                providers: [.init(id: "codex", label: "Codex", available: true, signed_in: true, models: [], message: nil)]))]
        }
        func conversations(owner: UUID) async throws -> [AgentConversation] {
            if failHistory { throw PostgrestError(code: "PGRST205", message: "Table not found") }
            return saved
        }
        func events(owner: UUID, conversation: UUID, after: Int64) async throws -> [AgentEvent] {
            cursors.append(after)
            return Array(timeline.filter { $0.seq > after && $0.conversation_id == conversation }.prefix(200))
        }
        func create(_ conversation: AgentConversation) async throws {
            if !saved.contains(where: { $0.id == conversation.id }) { saved.append(conversation) }
        }
        func send(_ command: AgentCommand) async throws {
            if !commands.contains(where: { $0.id == command.id }) {
                commands.append(command)
                timeline.append(AgentEvent(seq: Int64(timeline.count + 1), id: command.id, user_id: owner,
                    conversation_id: command.conversation_id, command_id: command.id, kind: "user", text: command.text, created_at: now))
            }
            if loseAcknowledgement {
                loseAcknowledgement = false
                throw URLError(.networkConnectionLost)
            }
        }
    }
}
