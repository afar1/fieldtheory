import SwiftUI

/// The reading/writing surface — one rich view, like the Mac's immersive
/// mode. Markdown syntax is concealed except on the caret's line; tap
/// anywhere to place the cursor and type. Autosaves continuously; pull down
/// from the top to close.
struct DocumentView: View {
    let doc: LibraryDocMeta
    var startEditing = false
    var onDelete: (() -> Void)?

    @Environment(AppModel.self) private var model
    @Environment(EditorFocusBus.self) private var editorFocus
    @Environment(ToastCenter.self) private var toast
    @Environment(ReadingState.self) private var readingState
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.dismiss) private var dismiss

    @State private var text = ""
    @State private var loaded = false
    @State private var saveTask: Task<Void, Never>?
    @State private var confirmDelete = false
    @State private var sharing = false
    @State private var showDisplayControls = false
    @State private var chromeHidden = false
    @State private var deleting = false
    @State private var documentWorkspace: UUID?
    @State private var loadFailed = false

    private var styling: MarkdownStyling {
        MarkdownStyling(
            typography: model.settings.typography,
            textColor: Theme.text(colorScheme),
            mutedColor: Theme.textMuted(colorScheme),
            accentColor: Theme.accent(model.settings.accentPreset, colorScheme)
        )
    }

    private var canMutateWorkspace: Bool {
        documentWorkspace == model.workspaceGeneration && model.showMainUI && !model.isSigningOut
    }

    private var compactChromeHidden: Bool {
        horizontalSizeClass != .regular && chromeHidden
    }

    private var pullDismissAction: (() -> Void)? {
        guard horizontalSizeClass != .regular else { return nil }
        return { dismiss() }
    }

    var body: some View {
        MarkdownEditor(
            text: $text,
            styling: styling,
            showLineNumbers: model.settings.showLineNumbers,
            focusBus: editorFocus,
            focusOnAppear: startEditing,
            maximumReadableWidth: horizontalSizeClass == .regular ? 720 : nil,
            accessibilityLabel: "\(doc.title) editor",
            onEditingChanged: { editing in
                if horizontalSizeClass != .regular {
                    setChromeHidden(editing)
                }
            },
            onChromeVisibilityChanged: { hidden in
                if horizontalSizeClass != .regular {
                    setChromeHidden(hidden)
                }
            },
            onPullDismiss: pullDismissAction
        )
        .disabled(!loaded)
        .overlay {
            if loadFailed {
                ContentUnavailableView {
                    Label("Couldn’t open note", systemImage: "doc.badge.ellipsis")
                } description: {
                    Text("The local file could not be read. It has not been replaced or changed.")
                } actions: {
                    Button("Try again") { Task { await loadDocument() } }
                }
                .background(Theme.background(colorScheme))
            }
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .background(Theme.background(colorScheme))
        .navigationTitle(doc.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
        .toolbar(compactChromeHidden ? .hidden : .visible, for: .navigationBar)
        .toolbar(compactChromeHidden ? .hidden : .visible, for: .tabBar)
        .toolbar { toolbarContent }
        .popover(isPresented: $showDisplayControls, arrowEdge: .top) {
            DocumentDisplayControls()
                .environment(model)
                .frame(minWidth: horizontalSizeClass == .regular ? 360 : nil,
                       idealWidth: horizontalSizeClass == .regular ? 400 : nil,
                       minHeight: horizontalSizeClass == .regular ? 400 : nil)
                .presentationCompactAdaptation(.sheet)
        }
        .confirmationDialog("Delete \"\(doc.title)\"?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete file", role: .destructive) {
                guard canMutateWorkspace else { return }
                deleting = true
                let library = model.library
                let pendingSave = saveTask
                pendingSave?.cancel()
                saveTask = nil
                Task {
                    if let pendingSave {
                        await pendingSave.value
                    }
                    guard canMutateWorkspace else { return }
                    await library.deleteDocument(doc)
                    if let onDelete {
                        onDelete()
                    } else {
                        dismiss()
                    }
                }
            }
        } message: {
            Text("Deletes from this device and, on next sync, everywhere.")
        }
        .task(id: doc.clientId) {
            if !loaded { await loadDocument() }
        }
        .onChange(of: text) { _, _ in
            guard loaded else { return }
            scheduleSave()
        }
        .onAppear { readingState.enter() }
        .onDisappear {
            readingState.exit()
            if !deleting {
                flushSave()
            }
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        if horizontalSizeClass == .regular {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button(action: copyDocument) {
                    Image(systemName: "doc.on.doc")
                }
                .accessibilityLabel("Copy document")

                Button {
                    shareToRiver()
                } label: {
                    Image(systemName: "water.waves")
                }
                .disabled(sharing)
                .accessibilityLabel(sharing ? "Sharing to River" : "Share to River")
                .keyboardShortcut("s", modifiers: [.command, .shift])

                Button { showDisplayControls = true } label: {
                    Image(systemName: "textformat.size")
                }
                .accessibilityIdentifier("Display")
                .accessibilityLabel("Display")
                .keyboardShortcut("t", modifiers: [.command, .option])

                Menu {
                    Button {
                        addToVoiceStack()
                    } label: {
                        Label("Add to Voice stack", systemImage: "square.stack.3d.up")
                    }
                    Divider()
                    Button(role: .destructive) {
                        confirmDelete = true
                    } label: {
                        Label("Delete file", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("More")
            }
        } else {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button(action: copyDocument) {
                    Image(systemName: "doc.on.doc")
                }
                .accessibilityLabel("Copy document")

                Menu {
                    Button {
                        shareToRiver()
                    } label: {
                        Label(sharing ? "Sharing…" : "Share to River", systemImage: "water.waves")
                    }
                    .disabled(sharing)
                    Button {
                        addToVoiceStack()
                    } label: {
                        Label("Add to Voice stack", systemImage: "square.stack.3d.up")
                    }
                    Button {
                        showDisplayControls = true
                    } label: {
                        Label("Display", systemImage: "textformat.size")
                    }
                    .accessibilityIdentifier("Display")
                    .accessibilityLabel("Display")
                    Divider()
                    Button(role: .destructive) {
                        confirmDelete = true
                    } label: {
                        Label("Delete file", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("More")
            }
        }
    }

    private func copyDocument() {
        UIPasteboard.general.string = "File: \(doc.fileName)\n\n\(text)"
        toast.show("Copied", symbol: "doc.on.doc")
    }

    private func addToVoiceStack() {
        guard canMutateWorkspace else { return }
        let transcripts = model.transcripts
        let snapshot = text
        Task {
            guard canMutateWorkspace else { return }
            let saved = await transcripts.addFileSegment(fileName: doc.fileName, content: snapshot, into: nil)
            guard saved, canMutateWorkspace else { return }
            toast.show("Stacked in Voice", symbol: "square.stack.3d.up")
        }
    }

    private func shareToRiver() {
        guard canMutateWorkspace else { return }
        guard !model.isReviewerDemoStorage else {
            toast.show("Sharing requires a signed-in team account", symbol: "icloud.slash")
            return
        }
        let sync = model.sync
        let snapshot = text
        sharing = true
        flushSave()
        Task {
            guard canMutateWorkspace else { return }
            let shared = await sync.shareToRiver(sourcePath: doc.sourcePath, content: snapshot)
            guard canMutateWorkspace else { return }
            sharing = false
            toast.show(
                shared ? "Shared to River" : "Couldn't share — check connection",
                symbol: shared ? "water.waves" : "exclamationmark.triangle"
            )
        }
    }

    private func loadDocument() async {
        documentWorkspace = model.workspaceGeneration
        guard let content = model.library.content(of: doc) else {
            loadFailed = true
            return
        }
        loadFailed = false
        text = content
        loaded = true
        await model.library.recordVisit(sourcePath: doc.sourcePath)
    }

    private func scheduleSave() {
        saveTask?.cancel()
        guard canMutateWorkspace else { return }
        let library = model.library
        let snapshot = text
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 800_000_000)
            guard !Task.isCancelled, canMutateWorkspace else { return }
            await library.save(sourcePath: doc.sourcePath, content: snapshot)
        }
    }

    private func flushSave() {
        guard loaded, canMutateWorkspace else { return }
        saveTask?.cancel()
        let library = model.library
        let snapshot = text
        Task {
            guard canMutateWorkspace else { return }
            await library.save(sourcePath: doc.sourcePath, content: snapshot)
        }
    }

    private func setChromeHidden(_ hidden: Bool) {
        guard chromeHidden != hidden else { return }
        withAnimation(.easeInOut(duration: 0.16)) {
            chromeHidden = hidden
        }
    }
}

private struct DocumentDisplayControls: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var settings = model.settings

        NavigationStack {
            Form {
                Section("Display") {
                    Toggle("Line numbers", isOn: $settings.showLineNumbers)
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
                }
            }
            .navigationTitle("Display")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
