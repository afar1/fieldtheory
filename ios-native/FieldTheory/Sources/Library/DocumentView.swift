import SwiftUI

/// The reading/writing surface — one rich view, like the Mac's immersive
/// mode. Markdown syntax is concealed except on the caret's line; tap
/// anywhere to place the cursor and type. Autosaves continuously; pull down
/// from the top to close.
struct DocumentView: View {
    let doc: LibraryDocMeta
    var startEditing = false

    @Environment(AppModel.self) private var model
    @Environment(EditorFocusBus.self) private var editorFocus
    @Environment(ToastCenter.self) private var toast
    @Environment(ReadingState.self) private var readingState
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dismiss) private var dismiss

    @State private var text = ""
    @State private var loaded = false
    @State private var saveTask: Task<Void, Never>?
    @State private var confirmDelete = false
    @State private var sharing = false

    private var styling: MarkdownStyling {
        MarkdownStyling(
            typography: model.settings.typography,
            textColor: Theme.text(colorScheme),
            mutedColor: Theme.textMuted(colorScheme),
            accentColor: Theme.accent(model.settings.accentPreset, colorScheme)
        )
    }

    var body: some View {
        MarkdownEditor(
            text: $text,
            styling: styling,
            focusBus: editorFocus,
            focusOnAppear: startEditing,
            onPullDismiss: { dismiss() }
        )
        .ignoresSafeArea(.container, edges: .bottom)
        .background(Theme.background(colorScheme))
        .navigationTitle(doc.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
        .toolbar { toolbarContent }
        .confirmationDialog("Delete \"\(doc.title)\"?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete file", role: .destructive) {
                Task {
                    await model.library.deleteDocument(doc)
                    dismiss()
                }
            }
        } message: {
            Text("Deletes from this phone and, on next sync, everywhere.")
        }
        .task(id: doc.clientId) {
            if !loaded {
                text = model.library.content(of: doc) ?? ""
                loaded = true
                await model.library.recordVisit(sourcePath: doc.sourcePath)
            }
        }
        .onChange(of: text) { _, _ in
            guard loaded else { return }
            scheduleSave()
        }
        .onAppear { readingState.enter() }
        .onDisappear {
            readingState.exit()
            flushSave()
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button {
                UIPasteboard.general.string = "File: \(doc.fileName)\n\n\(text)"
                toast.show("Copied", symbol: "doc.on.doc")
            } label: {
                Image(systemName: "doc.on.doc")
            }
            Menu {
                Button {
                    shareToRiver()
                } label: {
                    Label(sharing ? "Sharing…" : "Share to River", systemImage: "water.waves")
                }
                .disabled(sharing)
                Button {
                    Task {
                        await model.transcripts.addFileSegment(fileName: doc.fileName, content: text, into: nil)
                        toast.show("Stacked in Voice", symbol: "square.stack.3d.up")
                    }
                } label: {
                    Label("Add to Voice stack", systemImage: "square.stack.3d.up")
                }
                Menu {
                    Picker("Typeface", selection: typographyBinding) {
                        ForEach(TypographyPresetID.allCases) { preset in
                            Text(preset.displayName).tag(preset)
                        }
                    }
                    Picker("Size", selection: textSizeBinding) {
                        ForEach(TextSizeID.allCases) { size in
                            Text(size.displayName).tag(size)
                        }
                    }
                    Picker("Spacing", selection: lineHeightBinding) {
                        ForEach(LineHeightID.allCases) { height in
                            Text(height.displayName).tag(height)
                        }
                    }
                } label: {
                    Label("Typography", systemImage: "textformat.size")
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
        }
    }

    private var typographyBinding: Binding<TypographyPresetID> {
        Binding(get: { model.settings.typographyPreset }, set: { model.settings.typographyPreset = $0 })
    }

    private var textSizeBinding: Binding<TextSizeID> {
        Binding(get: { model.settings.textSize }, set: { model.settings.textSize = $0 })
    }

    private var lineHeightBinding: Binding<LineHeightID> {
        Binding(get: { model.settings.lineHeight }, set: { model.settings.lineHeight = $0 })
    }

    private func shareToRiver() {
        sharing = true
        flushSave()
        Task {
            let shared = await model.sync.shareToRiver(sourcePath: doc.sourcePath, content: text)
            sharing = false
            toast.show(
                shared ? "Shared to River" : "Couldn't share — check connection",
                symbol: shared ? "water.waves" : "exclamationmark.triangle"
            )
        }
    }

    private func scheduleSave() {
        saveTask?.cancel()
        let snapshot = text
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 800_000_000)
            guard !Task.isCancelled else { return }
            await model.library.save(sourcePath: doc.sourcePath, content: snapshot)
        }
    }

    private func flushSave() {
        saveTask?.cancel()
        let snapshot = text
        Task { await model.library.save(sourcePath: doc.sourcePath, content: snapshot) }
    }
}
