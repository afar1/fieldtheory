import SwiftUI

struct RiverShareSheet: View {
    let text: String
    let sourceID: String
    let onSend: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @State private var search = ""
    @State private var selected: Set<String> = []
    @State private var recipients: [RiverRecipient] = []
    @State private var loading = true
    @State private var sending = false
    @State private var error: String?
    @State private var showMore = false
    @State private var copied = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if loading { ProgressView() }
                    else if recipients.isEmpty && error == nil {
                        Text("Your approved River contacts and groups will appear here.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(recipients.filter { search.isEmpty || $0.label.localizedCaseInsensitiveContains(search) }) { recipient in
                        Button {
                            if selected.contains(recipient.id) { selected.remove(recipient.id) }
                            else { selected.insert(recipient.id) }
                        } label: {
                            HStack {
                                Image(systemName: recipient.kind == "group" ? "person.2.circle" : "person.crop.circle").font(.title2)
                                Text(recipient.label).foregroundStyle(.primary)
                                Spacer()
                                Image(systemName: selected.contains(recipient.id) ? "checkmark.circle.fill" : "circle")
                            }.padding(.vertical, 4)
                        }
                        .disabled(sending)
                    }
                }
                if let error {
                    Section {
                        Text(error).foregroundStyle(.secondary)
                        if !sending { Button("Try again") { Task { await load() } } }
                    }
                }
                Section {
                    Button { UIPasteboard.general.string = text; copied = true } label: {
                        Label(copied ? "Copied" : "Copy text", systemImage: "doc.on.doc")
                    }
                    Button { showMore = true } label: { Label("More…", systemImage: "square.and.arrow.up") }
                }
            }
            .searchable(text: $search, prompt: "People or groups")
            .navigationTitle("Share").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(sending) }
                ToolbarItem(placement: .confirmationAction) {
                    if sending { ProgressView() }
                    else { Button("Send") { Task { await send() } }.disabled(selected.isEmpty || !model.auth.sessionAlive || model.isReviewerDemoStorage) }
                }
            }
            .tint(Theme.accent(model.settings.accentPreset, colorScheme))
            .sheet(isPresented: $showMore) { RiverActivitySheet(text: text) }
            .task { await load() }
            .interactiveDismissDisabled(sending)
        }
    }

    private func load() async {
        loading = true
        error = nil
        defer { loading = false }
        guard !model.isReviewerDemoStorage, let userID = model.auth.userId?.uuidString.lowercased(), model.auth.sessionAlive else { return }
        let workspace = model.workspaceGeneration
        do {
            let loaded = try await RiverTransport(client: model.auth.client).recipients(userID: userID)
            guard workspace == model.workspaceGeneration, !Task.isCancelled else { return }
            recipients = loaded
            selected.formIntersection(Set(loaded.map(\.id)))
        } catch { self.error = "Couldn’t load recipients. Check your connection and try again." }
    }

    private func send() async {
        guard !sending, !model.isReviewerDemoStorage, let userID = model.auth.userId?.uuidString.lowercased() else { return }
        let workspace = model.workspaceGeneration
        sending = true
        error = nil
        defer { sending = false }
        do {
            try await RiverTransport(client: model.auth.client).share(text: text, sourceID: sourceID, selected: recipients.filter { selected.contains($0.id) }, userID: userID)
            guard workspace == model.workspaceGeneration, !Task.isCancelled else { return }
            model.river.requestRefresh()
            onSend()
        } catch { self.error = "Sharing didn’t finish. Your text is safe. Try Send again." }
    }
}
private struct RiverActivitySheet: UIViewControllerRepresentable {
    let text: String
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [text], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
