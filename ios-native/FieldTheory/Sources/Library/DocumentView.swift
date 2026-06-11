import SwiftUI

/// The reading/writing surface — the phone's version of the Mac's immersive
/// view. Rendered markdown by default; tap the page to drop into the live
/// editor; autosaves continuously.
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
    @State private var editing = false
    @State private var saveTask: Task<Void, Never>?
    @State private var chromeHidden = false
    @State private var parsedBlocks: [MDBlock] = []
    /// Reference type on purpose: per-frame scroll bookkeeping must not
    /// invalidate the view (a @State write per frame re-parses the document
    /// every frame — that was the reader freeze).
    private let scrollTracker = ScrollTracker()

    final class ScrollTracker {
        var lastOffset: CGFloat = 0
        var pulledToDismiss = false
        /// Chrome toggles change insets, which change the measured offset,
        /// which would re-trigger toggles — a livelock that froze the app.
        /// After any toggle, ignore events until the animation settles.
        var lastToggle: CFTimeInterval = 0
        var accumulated: CGFloat = 0

        func settled() -> Bool {
            CACurrentMediaTime() - lastToggle > 0.5
        }

        func markToggle() {
            lastToggle = CACurrentMediaTime()
            accumulated = 0
        }
    }

    private var styling: MarkdownStyling {
        MarkdownStyling(
            typography: model.settings.typography,
            textColor: Theme.text(colorScheme),
            mutedColor: Theme.textMuted(colorScheme),
            accentColor: Theme.accent(model.settings.accentPreset, colorScheme)
        )
    }

    /// Everything the parsed blocks bake in; changes trigger a reparse.
    private var stylingKey: String {
        "\(model.settings.typographyPreset.rawValue)-\(model.settings.textSize.rawValue)-\(model.settings.lineHeight.rawValue)-\(model.settings.accentPreset.rawValue)-\(colorScheme == .dark ? "dark" : "light")"
    }

    var body: some View {
        Group {
            if editing {
                MarkdownEditor(
                    text: $text,
                    styling: styling,
                    focusBus: editorFocus,
                    focusOnAppear: true
                )
                .ignoresSafeArea(.container, edges: .bottom)
            } else {
                readerView
            }
        }
        .background(Theme.background(colorScheme))
        .navigationTitle(doc.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
        .toolbarVisibility(chromeHidden && !editing ? .hidden : .visible, for: .navigationBar)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if editing {
                    Button("Done") {
                        editing = false
                        flushSave()
                    }
                    .fontWeight(.semibold)
                } else {
                    typographyMenu
                    Button {
                        UIPasteboard.general.string = "File: \(doc.fileName)\n\n\(text)"
                        toast.show("Copied", symbol: "doc.on.doc")
                    } label: {
                        Image(systemName: "doc.on.doc")
                    }
                    Menu {
                        Button {
                            Task {
                                await model.transcripts.addFileSegment(fileName: doc.fileName, content: text, into: nil)
                                toast.show("Stacked in Voice", symbol: "square.stack.3d.up")
                            }
                        } label: {
                            Label("Add to Voice stack", systemImage: "square.stack.3d.up")
                        }
                        Button {
                            editing = true
                        } label: {
                            Label("Edit", systemImage: "pencil")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .task(id: doc.clientId) {
            if !loaded {
                text = model.library.content(of: doc) ?? ""
                loaded = true
                editing = startEditing
                reparse()
                await model.library.recordVisit(sourcePath: doc.sourcePath)
            }
        }
        .onChange(of: text) { _, _ in
            guard loaded else { return }
            scheduleSave()
            if !editing { reparse() }
        }
        .onChange(of: editing) { _, isEditing in
            if !isEditing { reparse() }
        }
        .onChange(of: stylingKey) { _, _ in
            reparse()
        }
        .onAppear { readingState.enter() }
        .onDisappear {
            readingState.exit()
            flushSave()
        }
    }

    private var readerView: some View {
        ScrollView {
            MarkdownView(
                blocks: parsedBlocks,
                styling: styling,
                lazy: true,
                onToggleCheckbox: toggleCheckbox
            )
            .frame(maxWidth: 680, alignment: .leading)
            .padding(.horizontal, 22)
            .padding(.top, 14)
            .padding(.bottom, 140)
            .contentShape(Rectangle())
            .onTapGesture { editing = true }

            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("Tap to start writing")
                    .font(styling.typography.bodyFont(italic: true))
                    .foregroundStyle(Theme.textMuted(colorScheme))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 22)
                    .contentShape(Rectangle())
                    .onTapGesture { editing = true }
            }
        }
        .scrollIndicators(.hidden)
        // Reading chrome: scrolling down clears the deck, scrolling up
        // brings it back; one firm pull past the top closes the document.
        // Toggles change insets, so the handler must (a) wait out its own
        // animation, (b) judge direction from accumulated user travel, and
        // (c) ignore inset-sized jumps that aren't finger scrolling.
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
            geometry.contentOffset.y + geometry.contentInsets.top
        } action: { _, offset in
            if offset < -70 {
                if !scrollTracker.pulledToDismiss {
                    scrollTracker.pulledToDismiss = true
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    dismiss()
                }
                return
            }
            let delta = offset - scrollTracker.lastOffset
            scrollTracker.lastOffset = offset

            guard scrollTracker.settled() else { return }
            guard abs(delta) < 100 else { return } // inset jump, not a finger

            if (delta >= 0) != (scrollTracker.accumulated >= 0) {
                scrollTracker.accumulated = 0
            }
            scrollTracker.accumulated += delta

            if offset <= 8 {
                if chromeHidden {
                    scrollTracker.markToggle()
                    withAnimation(.easeOut(duration: 0.2)) { chromeHidden = false }
                }
            } else if scrollTracker.accumulated > 28, !chromeHidden {
                scrollTracker.markToggle()
                withAnimation(.easeOut(duration: 0.2)) { chromeHidden = true }
            } else if scrollTracker.accumulated < -28, chromeHidden {
                scrollTracker.markToggle()
                withAnimation(.easeOut(duration: 0.2)) { chromeHidden = false }
            }
        }
    }

    private func reparse() {
        parsedBlocks = MarkdownParser.parse(MarkdownParser.stripFrontmatter(text), styling: styling)
    }

    private var typographyMenu: some View {
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
            Image(systemName: "textformat.size")
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

    private func toggleCheckbox(atLine line: Int) {
        var lines = text.components(separatedBy: "\n")
        let index = line - 1
        guard index >= 0, index < lines.count else { return }
        if lines[index].contains("[ ]") {
            lines[index] = lines[index].replacingOccurrences(of: "[ ]", with: "[x]")
        } else if lines[index].lowercased().contains("[x]") {
            if let range = lines[index].range(of: "[x]") ?? lines[index].range(of: "[X]") {
                lines[index] = lines[index].replacingCharacters(in: range, with: "[ ]")
            }
        }
        text = lines.joined(separator: "\n")
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
