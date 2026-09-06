import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(ToastCenter.self) private var toast
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var showFolderPicker = false

    var body: some View {
        @Bindable var settings = model.settings

        NavigationStack {
            Form {
                Section("Reading") {
                    Picker("Typeface", selection: $settings.typographyPreset) {
                        ForEach(TypographyPresetID.allCases) { preset in
                            Text(preset.displayName).tag(preset)
                        }
                    }
                    Picker("Text size", selection: $settings.textSize) {
                        ForEach(TextSizeID.allCases) { size in
                            Text(size.displayName).tag(size)
                        }
                    }
                    Picker("Line spacing", selection: $settings.lineHeight) {
                        ForEach(LineHeightID.allCases) { height in
                            Text(height.displayName).tag(height)
                        }
                    }
                    Toggle("Line numbers", isOn: $settings.showLineNumbers)
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

                Section("Library") {
                    Button {
                        showFolderPicker = true
                    } label: {
                        HStack {
                            Text("Synced folders")
                                .foregroundStyle(.primary)
                            Spacer()
                            Text(syncedFoldersSummary)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Picker("New documents go to", selection: $settings.newDocFolder) {
                        ForEach(model.library.folders) { folder in
                            Text(folder.displayName).tag(folder.name)
                        }
                        if !model.library.folders.contains(where: { $0.name == settings.newDocFolder }) {
                            Text(settings.newDocFolder).tag(settings.newDocFolder)
                        }
                    }
                }

                Section("Voice") {
                    modelRow
                    Toggle("Copy transcripts automatically", isOn: $settings.autoCopyTranscripts)
                }

                Section("Sync") {
                    HStack {
                        Text("Status")
                        Spacer()
                        switch model.sync.status {
                        case .idle:
                            Text(model.sync.lastSyncAt.map { "Synced \($0.relativeShort)" } ?? "Waiting")
                                .foregroundStyle(.secondary)
                        case .syncing:
                            ProgressView()
                        case .error(let message):
                            Text(message)
                                .foregroundStyle(Theme.unread)
                                .lineLimit(2)
                                .font(.system(size: 13))
                        }
                    }
                    Button("Sync now") {
                        Task { await model.sync.syncNow() }
                    }
                }

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
                } header: {
                    Text("Account")
                } footer: {
                    Text("Everything works offline — reading, writing, recording, transcribing. A connection is only used to sync. Signing out removes the synced copy from this device.")
                }

                Section {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
                            .foregroundStyle(.secondary)
                    }
                } footer: {
                    Text("Reading preferences use the same names and values as the Mac app, ready for preference sync.")
                }
            }
            .modifier(SettingsFormLayout(
                regularWidth: horizontalSizeClass == .regular,
                colorScheme: colorScheme
            ))
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                }
            }
            .sheet(isPresented: $showFolderPicker) {
                FolderPickerView()
            }
        }
    }

    private var syncedFoldersSummary: String {
        guard let selected = model.settings.syncedFolders else { return "All" }
        return "\(selected.count) of \(model.library.folders.count)"
    }

    @ViewBuilder
    private var modelRow: some View {
        switch model.recorder.models.state {
        case .ready:
            HStack {
                Text("Speech model")
                Spacer()
                Label("On device", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(Theme.markRead)
                    .font(.system(size: 14))
            }
        case .downloading(let progress):
            VStack(alignment: .leading, spacing: 6) {
                Text("Downloading speech model…")
                ProgressView(value: progress)
            }
        case .notDownloaded:
            Button("Download speech model (142 MB)") {
                model.recorder.models.ensureDownloaded()
            }
        case .failed(let message):
            VStack(alignment: .leading, spacing: 4) {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.unread)
                Button("Retry download") {
                    model.recorder.models.ensureDownloaded()
                }
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
