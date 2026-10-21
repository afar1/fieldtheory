import SwiftUI

/// Opens the user's saved ChatGPT App Intent shortcut. No recording, clipboard
/// content, or task identifier is passed to Shortcuts.
enum ChatGPTRemoteLink {
    static func shortcutURL(name: String) -> URL? {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return nil }
        var components = URLComponents()
        components.scheme = "shortcuts"
        components.host = "run-shortcut"
        components.queryItems = [URLQueryItem(name: "name", value: name)]
        return components.url
    }
}

struct ChatGPTRemoteButton: View {
    var onWillOpen: () -> Void = {}
    @AppStorage("chatgpt-remote-shortcut-name") private var shortcutName = "Open Codex"
    @AppStorage("chatgpt-remote-shortcut-configured") private var configured = false
    @Environment(\.openURL) private var openURL
    @State private var showingSetup = false
    @State private var showingError = false

    private var isAvailable: Bool { configured }

    var body: some View {
        if isAvailable {
            Button {
            onWillOpen()
            guard configured, let url = ChatGPTRemoteLink.shortcutURL(name: shortcutName) else {
                showingSetup = true
                return
            }
            openURL(url) { accepted in
                if !accepted { showingError = true }
            }
            } label: {
                Label("Open chat", systemImage: "bubble.right")
                    .foregroundStyle(.secondary)
            }
            .accessibilityIdentifier("OpenChatGPTRemote")
            .accessibilityHint("Opens the Remote task list in ChatGPT through your shortcut.")
            .contextMenu {
                Button("Configure Remote shortcut") {
                    onWillOpen()
                    showingSetup = true
                }
            }
            .sheet(isPresented: $showingSetup) {
                ChatGPTRemoteSetupView()
            }
            .alert("Could not open Shortcuts", isPresented: $showingError) {
                Button("Set up shortcut") { showingSetup = true }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Make sure Shortcuts and ChatGPT are installed, then check your Remote shortcut setup.")
            }
        }
    }
}

struct ChatGPTRemoteSetupView: View {
    @AppStorage("chatgpt-remote-shortcut-name") private var shortcutName = "Open Codex"
    @AppStorage("chatgpt-remote-shortcut-configured") private var configured = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("In Shortcuts, create a shortcut with ChatGPT’s Open Codex action. Leave Create new task turned off, then save it with the name below.")
                    TextField("Shortcut name", text: $shortcutName)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("RemoteShortcutName")
                    Link("Open Shortcuts", destination: URL(string: "shortcuts://")!)
                    Button("I’ve added this shortcut") {
                        shortcutName = shortcutName.trimmingCharacters(in: .whitespacesAndNewlines)
                        configured = true
                        dismiss()
                    }
                    .disabled(ChatGPTRemoteLink.shortcutURL(name: shortcutName) == nil)
                } footer: {
                    Text("Open Remote runs this saved shortcut to show your task list in ChatGPT. It does not select a particular task or send your recording. If Shortcuts reports that it cannot find the shortcut, check that its name matches exactly.")
                }
            }
            .navigationTitle("ChatGPT Remote")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
