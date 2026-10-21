import SwiftUI

struct ConversationView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var draft = ""
    @State private var provider = ""
    @State private var selectedModel = ""
    @State private var showHistory = false
    @State private var showSignIn = false
    @FocusState private var composing: Bool

    private var store: ConversationStore { model.conversations }
    private var currentProvider: AgentRunner.Provider? { store.availableProviders.first { $0.id == provider } }
    private var sampleRelay: Bool {
#if targetEnvironment(simulator)
        model.launchDirectives.contains("ft-agent-preview")
#else
        false
#endif
    }
    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && draft.count <= 120_000
            && (model.auth.hasIdentity || sampleRelay) && (store.selected != nil || currentProvider != nil)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                connectionStatus
                if store.selected == nil {
                    startConversation
                } else {
                    timeline
                }
            }
            .navigationTitle(store.selected?.title ?? "Agent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("History", systemImage: "clock") { showHistory = true }
                        .accessibilityIdentifier("agent-history")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New conversation", systemImage: "square.and.pencil") {
                        store.select(nil)
                        draft = ""
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { composer }
            .sheet(isPresented: $showHistory) { history }
            .sheet(isPresented: $showSignIn) { SignInView() }
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                while !Task.isCancelled {
                    await store.refresh()
                    do { try await Task.sleep(for: .seconds(3)) }
                    catch { return }
                }
            }
            .onChange(of: store.availableProviders.map(\.id), initial: true) { _, ids in
                if !ids.contains(provider) { provider = ids.first ?? ""; selectedModel = "" }
            }
            .onChange(of: store.draftFromVoice, initial: true) { _, text in
                if let text { draft = text; store.draftFromVoice = nil; composing = true }
            }
            .onChange(of: model.auth.sessionAlive) { _, alive in
                if alive { showSignIn = false }
            }
            .onChange(of: model.auth.userId) { _, _ in draft = "" }
        }
    }

    private var connectionStatus: some View {
        VStack(alignment: .leading, spacing: 8) {
            if sampleRelay {
                Label("Sample conversation · local simulator relay", systemImage: "testtube.2")
            } else if !model.auth.sessionAlive {
                Label("Saved history · Sign in to reconnect", systemImage: "wifi.slash")
                Button("Sign in to Field Theory") { showSignIn = true }
            } else if store.lastChecked == nil && store.isRefreshing {
                ProgressView("Connecting…")
            } else if store.onlineRunners.isEmpty {
                Label("Mac runner offline or not connected", systemImage: "desktopcomputer")
                Text("Open Field Theory on your Mac, enable its Voice runner and select a workspace. Queued messages wait for the Mac to reconnect.")
                    .font(.caption)
            } else {
                Label("Connected to Mac runner", systemImage: "checkmark.circle")
                if let conversation = store.selected {
                    Text("\(conversation.provider.capitalized) · \(conversation.status.replacingOccurrences(of: "_", with: " "))")
                        .font(.caption)
                }
            }
            if let issue = store.issue {
                Text(issue).foregroundStyle(.red).accessibilityIdentifier("agent-connection-error")
                Button("Retry connection") { Task { await store.refresh() } }
            }
            if store.pendingCount > 0 {
                Text("\(store.pendingCount) message(s) saved on this phone, awaiting relay.")
                    .accessibilityIdentifier("agent-pending")
            }
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.bar)
    }

    private var startConversation: some View {
        Form {
            Section {
                Text("Talk to one orchestrator. Its replies and sub-agent progress return here. Follow-ups continue the same conversation.")
            }
            Section("Run on your Mac") {
                Text("This runner currently supports read-only work and bounded research delegation.")
                    .font(.footnote).foregroundStyle(.secondary)
                Picker("Orchestrator", selection: $provider) {
                    if store.availableProviders.isEmpty { Text("No signed-in providers").tag("") }
                    ForEach(store.availableProviders) { item in Text(item.label).tag(item.id) }
                }
                .onChange(of: provider) { _, _ in selectedModel = "" }
                Picker("Model", selection: $selectedModel) {
                    Text("Provider default").tag("")
                    ForEach(currentProvider?.models ?? []) { item in Text(item.label).tag(item.id) }
                }
                Text("Provider sign-in stays on your Mac. Field Theory sign-in connects this phone to your private conversation relay.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if store.availableProviders.isEmpty {
                Section("Provider connection") {
                    ForEach(store.onlineRunners) { runner in
                        ForEach(runner.capabilities.providers) { item in
                            VStack(alignment: .leading) {
                                Text(item.label)
                                Text(item.message ?? "Sign in to this provider on your Mac.")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
    }

    private var timeline: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    if store.events.isEmpty && store.unechoedCommands.isEmpty {
                        ContentUnavailableView("No messages yet", systemImage: "bubble.left.and.bubble.right",
                            description: Text("Send a message to continue this conversation."))
                    }
                    ForEach(store.events) { event in
                        eventRow(event)
                    }
                    ForEach(store.unechoedCommands) { command in
                        VStack(alignment: .leading, spacing: 6) {
                            Label("You", systemImage: "person.crop.circle").font(.headline)
                            Text(command.text).textSelection(.enabled)
                            Text(store.isPending(command.id) ? "Saved on phone · awaiting relay" : "Queued for orchestrator")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    Color.clear.frame(height: 1).id("latest")
                }
                .padding()
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await store.refresh() }
            .overlay(alignment: .bottomTrailing) {
                Button("Latest", systemImage: "arrow.down") {
                    withAnimation { proxy.scrollTo("latest", anchor: .bottom) }
                }
                .buttonStyle(.bordered).padding()
            }
            .onChange(of: store.unechoedCommands.count) { old, new in
                if new > old { withAnimation { proxy.scrollTo("latest", anchor: .bottom) } }
            }
        }
    }

    private func eventRow(_ event: AgentEvent) -> some View {
        let delegated = event.kind == "delegation" || event.payload?.parent_run_id != nil
        let title = delegated ? "Sub-agent" : ["user": "You", "assistant": "Orchestrator", "error": "Needs attention"][event.kind] ?? "Progress"
        let symbol = delegated ? "person.2" : ["user": "person.crop.circle", "assistant": "bubble.left", "error": "exclamationmark.triangle"][event.kind] ?? "ellipsis.bubble"
        return VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: symbol).font(.headline)
            Text(event.text.isEmpty ? (event.payload?.status ?? "Status updated") : event.text)
                .textSelection(.enabled)
            if let provider = event.payload?.provider, delegated {
                Text(provider.capitalized).font(.caption).foregroundStyle(.secondary)
            }
            Text(Date(timeIntervalSince1970: Double(Timestamps.ms(fromISO: event.created_at)) / 1000), style: .time)
                .font(.caption).foregroundStyle(.secondary)
        }
        .foregroundStyle(event.kind == "error" ? Color.red : Color.primary)
        .accessibilityElement(children: .combine)
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 12) {
            TextField("Message orchestrator", text: $draft, axis: .vertical)
                .lineLimit(1...6)
                .textFieldStyle(.roundedBorder)
                .focused($composing)
                .accessibilityIdentifier("agent-composer")
            Button("Send", systemImage: "arrow.up.circle.fill") {
                if store.enqueue(text: draft, provider: provider, model: selectedModel.isEmpty ? nil : selectedModel) {
                    draft = ""
                    Task { await store.refresh() }
                }
            }
            .labelStyle(.iconOnly)
            .font(.title)
            .disabled(!canSend)
            .accessibilityIdentifier("agent-send")
        }
        .padding()
        .background(.bar)
    }

    private var history: some View {
        NavigationStack {
            List(store.conversations) { conversation in
                Button {
                    store.select(conversation.id)
                    draft = ""
                    showHistory = false
                    Task { await store.refresh() }
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(conversation.title).foregroundStyle(.primary)
                        Text("\(conversation.provider.capitalized) · \(conversation.status.replacingOccurrences(of: "_", with: " "))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .overlay {
                if store.conversations.isEmpty {
                    ContentUnavailableView("No saved conversations", systemImage: "clock")
                }
            }
            .navigationTitle("Conversations")
            .toolbar { Button("Done") { showHistory = false } }
        }
    }
}
