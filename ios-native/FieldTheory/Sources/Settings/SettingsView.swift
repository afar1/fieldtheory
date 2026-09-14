import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(ToastCenter.self) private var toast
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var showDeleteConfirmation = false
    @State private var deleteConfirmationEmail = ""

    var body: some View {
        @Bindable var settings = model.settings

        NavigationStack {
            Form {
                Section("Appearance") {
                    Picker("Accent", selection: $settings.accentPreset) {
                        ForEach(AccentPreset.allCases) { preset in
                            HStack {
                                Circle()
                                    .fill(colorScheme == .dark ? preset.dark : preset.light)
                                    .frame(width: 14, height: 14)
                                Text(preset.displayName)
                            }
                            .tag(preset)
                        }
                    }
                    Picker("Appearance", selection: $settings.appearanceMode) {
                        ForEach(AppearanceMode.allCases) { mode in
                            Text(mode.displayName).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section {
                    Toggle("Start recording on open", isOn: $settings.startRecordingOnOpen)
                        .accessibilityIdentifier("StartRecordingOnOpen")
                    Toggle("Confirm before discarding", isOn: $settings.confirmBeforeDiscarding)
                        .accessibilityIdentifier("ConfirmBeforeDiscarding")
                    modelRow
                    Toggle("Copy transcripts automatically", isOn: $settings.autoCopyTranscripts)
                    NavigationLink("Word replacements") {
                        WordReplacementsView(store: model.sync.wordSubstitutions)
                    }
                    if let error = model.sync.wordSubstitutionSyncError {
                        Text(error).font(.caption).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Field Theory")
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Parakeet downloads only when you choose Download. Download continues when Field Theory is in the background. Reopen the app if you force quit it.")
                        Text("The model is NVIDIA Parakeet, converted to Core ML by Fluid Inference, under CC BY 4.0.")
                        Link("Parakeet model attribution", destination: URL(string: "https://huggingface.co/FluidInference/parakeet-tdt-0.6b-v2-coreml")!)
                            .accessibilityIdentifier("ParakeetModelAttributionLink")
                    }
                }

                syncSection

                Section {
                    NavigationLink("Configure Remote shortcut") {
                        ChatGPTRemoteSetupView()
                    }
                    .accessibilityIdentifier("ConfigureChatGPTRemote")
                } header: {
                    Text("ChatGPT Remote")
                } footer: {
                    Text("Open Remote runs your saved shortcut to show the Remote task list in ChatGPT. It does not send recording data.")
                }

                accountSection

                Section("Privacy & Support") {
                    Link("Privacy Policy", destination: AppLinks.privacyPolicy)
                        .accessibilityIdentifier("PrivacyPolicyLink")
                    Link("Contact Support", destination: AppLinks.support)
                        .accessibilityIdentifier("SupportLink")
                }

                Section {
                    HStack {
                        Text("Field Theory")
                    }
                    HStack {
                        Text("Version")
                        Spacer()
                        Text(versionAndBuild)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .modifier(SettingsFormLayout(
                regularWidth: horizontalSizeClass == .regular,
                colorScheme: colorScheme
            ))
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(model.auth.accountDeletionState == .deleting)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                        .disabled(model.auth.accountDeletionState == .deleting)
                }
            }
            .alert("Permanently delete account?", isPresented: $showDeleteConfirmation) {
                TextField("Type your email to confirm", text: $deleteConfirmationEmail)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button("Delete Account", role: .destructive) {
                    deleteAccount()
                }
                .disabled(!AccountDeletionConfirmation.matches(
                    deleteConfirmationEmail,
                    accountEmail: model.auth.email
                ))
                Button("Cancel", role: .cancel) {
                    deleteConfirmationEmail = ""
                }
            } message: {
                Text("This permanently deletes your Field Theory account, synced content, shared data, and any active subscription. This cannot be undone.")
            }
        }
    }

    @ViewBuilder
    private var syncSection: some View {
        if model.auth.isReviewerDemo {
            Section {
                Label("Disabled in Reviewer Demo", systemImage: "icloud.slash")
                    .foregroundStyle(.secondary)
            } header: {
                Text("Sync")
            } footer: {
                Text("Reviewer Demo uses an isolated sample workspace on this device and never contacts production sync.")
            }
        } else {
            Section {
                HStack {
                    Text("Status")
                    Spacer()
                    switch model.sync.status {
                    case .idle:
                        Text(model.sync.lastSyncAt.map { "Synced to your account \($0.relativeShort)" } ?? "Automatic when signed in")
                            .foregroundStyle(.secondary)
                    case .syncing:
                        ProgressView()
                    case .error(let message):
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("Voice sync needs attention")
                                .foregroundStyle(Theme.unread)
                            Text(message)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                        .font(.system(size: 13))
                    }
                }
                Button(syncActionTitle) {
                    Task { await model.sync.syncNow() }
                }
                .disabled(!model.auth.sessionAlive)
            } header: {
                Text("Sync")
            } footer: {
                Text("When signed in, Voice syncs automatically. A successful sync confirms storage in your account; it does not confirm another device has received the transcript.")
            }
        }
    }

    @ViewBuilder
    private var accountSection: some View {
        if model.auth.isReviewerDemo {
            Section {
                Label("Local sample workspace", systemImage: "checkmark.shield")
                Button("Exit Reviewer Demo", role: .destructive) {
                    Task {
                        await model.exitReviewerDemo()
                        model.auth.endReviewerDemo()
                        dismiss()
                    }
                }
            } header: {
                Text("Reviewer Demo")
            } footer: {
                Text("Sample changes stay in the demo workspace and are removed when you exit. Reviewer Demo does not create or use an account.")
            }
        } else {
            Section {
                HStack {
                    Text("Signed in as")
                    Spacer()
                    Text(model.auth.email ?? "—")
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Text("Connection")
                    Spacer()
                    if model.auth.sessionAlive {
                        Label("Connected", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(Theme.markRead)
                            .font(.system(size: 14))
                    } else {
                        Label("Offline", systemImage: "wifi.slash")
                            .foregroundStyle(.secondary)
                            .font(.system(size: 14))
                    }
                }
                Button("Sign out", role: .destructive) {
                    Task {
                        await model.signOutCompletely()
                        dismiss()
                    }
                }
                .disabled(model.auth.accountDeletionState == .deleting)

                Button("Delete Account", role: .destructive) {
                    deleteConfirmationEmail = ""
                    model.auth.resetAccountDeletionState()
                    showDeleteConfirmation = true
                }
                .disabled(!model.auth.sessionAlive || model.auth.accountDeletionState == .deleting)

                if model.auth.accountDeletionState == .deleting {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Deleting account and synced data…")
                            .foregroundStyle(.secondary)
                    }
                } else if let error = model.auth.accountDeletionError {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.unread)
                }
            } header: {
                Text("Account")
            } footer: {
                Text("After signing in and downloading the speech model, Voice works offline. Locally created or edited Voice transcripts and stacks upload when connected. Signing out removes the device copy only; it does not delete your account. Account deletion requires a live authenticated session.")
            }
        }
    }

    private var versionAndBuild: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
        return "\(version) (\(build))"
    }

    private var syncActionTitle: String {
        if case .error = model.sync.status {
            return "Retry Voice sync"
        }
        return "Sync Voice now"
    }

    private func deleteAccount() {
        deleteConfirmationEmail = ""
        Task {
            let deleted = await model.auth.deleteAccount {
                await model.signOutCompletely()
            }
            if deleted { dismiss() }
        }
    }

    @ViewBuilder
    private var modelRow: some View {
        switch model.recorder.engineState {
        case .checking:
            HStack {
                Text("Checking Parakeet…")
                Spacer()
                ProgressView()
            }
        case .downloading(let progress):
            VStack(alignment: .leading, spacing: 6) {
                Text("Downloading Parakeet…")
                ProgressView(value: progress)
                Text("\(Int(progress * 100))%")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Text("You can leave the app or lock your phone. If you force-quit Field Theory, reopen it and retry to continue the download.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        case .preparing:
            HStack {
                Text(model.recorder.preparationMessage)
                Spacer()
                ProgressView()
            }
        case .ready:
            HStack {
                Text("Transcription model")
                Spacer()
                Label("Voice model ready", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(Theme.markRead)
                    .font(.system(size: 14))
            }
            .accessibilityIdentifier("SpeechEngineReady")
        case .notDownloaded:
            VStack(alignment: .leading, spacing: 6) {
                Text("Parakeet is not downloaded.")
                    .foregroundStyle(.secondary)
                Button("Download Parakeet — \(ParakeetModelManager.approximateDownloadSize)") {
                    model.recorder.downloadSpeechEngine()
                }
                .accessibilityIdentifier("DownloadSelectedSpeechEngine")
                Text("Downloads only when you choose Download.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        case .failed(let message):
            VStack(alignment: .leading, spacing: 6) {
                Text("Parakeet needs attention")
                    .foregroundStyle(Theme.unread)
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Try Parakeet again") {
                    model.recorder.downloadSpeechEngine()
                }
                .accessibilityIdentifier("RetrySelectedSpeechEngineDownload")
            }
        }
    }

}

private struct SettingsFormLayout: ViewModifier {
    let regularWidth: Bool
    let colorScheme: ColorScheme

    @ViewBuilder
    func body(content: Content) -> some View {
        if regularWidth {
            content
                .scrollContentBackground(.hidden)
                .background(Theme.background(colorScheme))
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
        } else {
            content
        }
    }
}

private struct WordReplacementsView: View {
    let store: WordSubstitutionSettings
    @State private var from = ""
    @State private var to = ""
    @State private var editingFrom: String?

    var body: some View {
        Form {
            Section {
                TextField("Heard word or phrase", text: $from)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Replace with", text: $to)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Button(editingFrom == nil ? "Add replacement" : "Save replacement") {
                    let source = from.trimmingCharacters(in: .whitespacesAndNewlines)
                    var pairs = store.pairs
                    if let editingFrom, let index = pairs.firstIndex(where: { $0.from == editingFrom }) {
                        pairs[index] = WordSubstitution(from: source, to: to)
                    } else {
                        pairs.append(WordSubstitution(from: source, to: to))
                    }
                    store.set(pairs)
                    from = ""
                    to = ""
                    editingFrom = nil
                }
                .disabled(from.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || from.count > 500 || to.count > 2000
                    || store.pairs.contains { $0.from == from.trimmingCharacters(in: .whitespacesAndNewlines) && $0.from != editingFrom })
                if editingFrom != nil {
                    Button("Cancel", role: .cancel) { editingFrom = nil; from = ""; to = "" }
                }
            } footer: {
                Text("Replacements apply to new transcripts and sync with your Mac when online. Tap a replacement to edit it; swipe to delete.")
            }
            Section("Replacements") {
                ForEach(store.pairs, id: \.from) { pair in
                    Button {
                        editingFrom = pair.from
                        from = pair.from
                        to = pair.to
                    } label: {
                        HStack {
                            Text(pair.from)
                            Image(systemName: "arrow.right").foregroundStyle(.secondary)
                            Text(pair.to.isEmpty ? "(remove)" : pair.to)
                        }
                    }
                }
                .onDelete { indices in
                    var pairs = store.pairs
                    pairs.remove(atOffsets: indices)
                    store.set(pairs)
                    editingFrom = nil
                    from = ""
                    to = ""
                }
            }
        }
        .navigationTitle("Word replacements")
    }
}
