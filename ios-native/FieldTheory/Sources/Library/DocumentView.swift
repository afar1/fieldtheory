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
    @Environment(\.colorScheme) private var colorScheme

    @State private var text = ""
    @State private var loaded = false
    @State private var editing = false
    @State private var saveTask: Task<Void, Never>?

    private var styling: MarkdownStyling {
        MarkdownStyling(
            typography: model.settings.typography,
            textColor: Theme.text(colorScheme),
            mutedColor: Theme.textMuted(colorScheme),
            accentColor: Theme.accent(model.settings.accentPreset, colorScheme)
        )
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
                await model.library.recordVisit(sourcePath: doc.sourcePath)
            }
        }
        .onChange(of: text) { _, _ in
            guard loaded else { return }
            scheduleSave()
        }
        .onDisappear { flushSave() }
    }

    private var readerView: some View {
        ScrollView {
            MarkdownView(
                blocks: MarkdownParser.parse(MarkdownParser.stripFrontmatter(text), styling: styling),
                styling: styling,
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
