import SwiftUI

enum RiverReaderPresentation: Equatable {
    case fullScreen
    case splitDetail
}

/// Horizontally paged reading with a vertically scrolling document. The phone
/// presents it full-screen; iPad keeps it synchronized with the master list.
struct RiverReaderView: View {
    let items: [RiverItem]
    let startAt: RiverItem
    let selection: Binding<String?>?
    let presentation: RiverReaderPresentation

    @Environment(AppModel.self) private var model
    @Environment(ToastCenter.self) private var toast
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    @State private var currentId: String?
    @State private var reportItem: RiverItem?
    @State private var blockCandidate: RiverItem?
    @State private var showSafetyPolicy = false

    init(
        items: [RiverItem],
        startAt: RiverItem,
        selection: Binding<String?>? = nil,
        presentation: RiverReaderPresentation = .fullScreen
    ) {
        self.items = items
        self.startAt = startAt
        self.selection = selection
        self.presentation = presentation
    }

    var body: some View {
        Group {
            if presentation == .fullScreen {
                pages
                    .ignoresSafeArea(edges: .bottom)
                    .overlay(alignment: .bottomTrailing) { compactControls }
            } else {
                pages
                    .safeAreaInset(edge: .top, spacing: 0) { detailControls }
            }
        }
        .background(Theme.background(colorScheme))
        .onAppear {
            currentId = selection?.wrappedValue ?? startAt.id
        }
        .onChange(of: selection?.wrappedValue) { _, id in
            guard let id, id != currentId else { return }
            currentId = id
        }
        .onChange(of: currentId) { _, id in
            guard let id, let item = items.first(where: { $0.id == id }) else { return }
            if selection?.wrappedValue != id {
                selection?.wrappedValue = id
            }
            if presentation == .fullScreen {
                Task { await model.river.markRead(item) }
            }
        }
        .onChange(of: items.map(\.id)) { _, ids in
            guard let currentId, !ids.contains(currentId) else { return }
            let fallback = items.first?.id
            self.currentId = fallback
            selection?.wrappedValue = fallback
        }
        .sheet(item: $reportItem) { item in
            RiverReportComposer(item: item)
        }
        .sheet(isPresented: $showSafetyPolicy) {
            RiverSafetyPolicyView()
        }
        .confirmationDialog(
            "Block \(blockCandidate?.authorLabel ?? "author")?",
            isPresented: Binding(
                get: { blockCandidate != nil },
                set: { if !$0 { blockCandidate = nil } }
            ),
            titleVisibility: .visible,
            presenting: blockCandidate
        ) { item in
            Button("Block author", role: .destructive) { block(item) }
            Button("Cancel", role: .cancel) { blockCandidate = nil }
        } message: { _ in
            Text("This hides the author’s River items on this device for this account. It does not remove content from River, notify the author, or file a report.")
        }
    }

    private var pages: some View {
        TabView(selection: $currentId) {
            ForEach(items) { item in
                RiverPageView(
                    item: item,
                    topInset: presentation == .fullScreen ? 60 : 26,
                    bottomInset: presentation == .fullScreen ? 120 : 72,
                    allowsPullToDismiss: presentation == .fullScreen
                )
                    .tag(Optional(item.id))
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
    }

    /// Thumb-reach controls, bottom-right: copy, more, close.
    private var compactControls: some View {
        HStack(spacing: 14) {
            if let item = currentItem {
                Button {
                    UIPasteboard.general.string = item.clipboardText
                    toast.show("Copied", symbol: "doc.on.doc")
                } label: {
                    Image(systemName: "doc.on.doc")
                        .controlIconStyle()
                }
                Menu {
                    Button {
                        Task {
                            let workspace = model.workspaceGeneration
                            let saved = await model.transcripts.addFileSegment(fileName: item.fileName, content: item.content, into: nil)
                            guard saved, workspace == model.workspaceGeneration else { return }
                            toast.show("Stacked in Voice", symbol: "square.stack.3d.up")
                        }
                    } label: {
                        Label("Add to Voice stack", systemImage: "square.stack.3d.up")
                    }
                    Button {
                        Task { await model.river.markUnread(item) }
                        dismiss()
                    } label: {
                        Label("Keep unread", systemImage: "envelope.badge")
                    }
                    Divider()
                    safetyActions(for: item)
                } label: {
                    Image(systemName: "ellipsis")
                        .controlIconStyle()
                }
                .accessibilityLabel("River document actions")
            }
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .controlIconStyle()
            }
        }
        .padding(.trailing, 18)
        .padding(.bottom, 30)
    }

    /// Persistent iPad reader controls. Read state is explicit here: moving
    /// through the list or paging does not silently triage a document.
    private var detailControls: some View {
        HStack(spacing: 6) {
            detailButton(
                symbol: "chevron.left",
                label: "Previous document",
                disabled: !canMove(by: -1),
                shortcut: "["
            ) {
                moveCurrent(by: -1)
            }

            detailButton(
                symbol: "chevron.right",
                label: "Next document",
                disabled: !canMove(by: 1),
                shortcut: "]"
            ) {
                moveCurrent(by: 1)
            }

            Spacer(minLength: 20)

            if let item = currentItem {
                let unread = model.river.isUnread(item)

                detailButton(
                    symbol: unread ? "envelope.open" : "envelope.badge",
                    label: unread ? "Mark read" : "Mark unread",
                    shortcut: "u",
                    modifiers: [.command, .shift]
                ) {
                    toggleRead(item)
                }

                detailButton(
                    symbol: "doc.on.doc",
                    label: "Copy",
                    shortcut: "c",
                    modifiers: [.command, .shift]
                ) {
                    UIPasteboard.general.string = item.clipboardText
                    toast.show("Copied", symbol: "doc.on.doc")
                }

                Menu {
                    Button {
                        Task {
                            let workspace = model.workspaceGeneration
                            let saved = await model.transcripts.addFileSegment(
                                fileName: item.fileName,
                                content: item.content,
                                into: nil
                            )
                            guard saved, workspace == model.workspaceGeneration else { return }
                            toast.show("Stacked in Voice", symbol: "square.stack.3d.up")
                        }
                    } label: {
                        Label("Add to Voice stack", systemImage: "square.stack.3d.up")
                    }
                    Divider()
                    safetyActions(for: item)
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(width: 38, height: 34)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .help("More actions")
                .accessibilityLabel("River document actions")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.regularMaterial)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Theme.border(colorScheme))
                .frame(height: 0.5)
        }
    }

    private func detailButton(
        symbol: String,
        label: String,
        disabled: Bool = false,
        shortcut: KeyEquivalent,
        modifiers: EventModifiers = .command,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 38, height: 34)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(disabled ? Theme.textMuted(colorScheme).opacity(0.45) : Theme.text(colorScheme))
        .disabled(disabled)
        .hoverEffect(.highlight)
        .help("\(label) (\(shortcutLabel(shortcut, modifiers: modifiers)))")
        .accessibilityLabel(label)
        .keyboardShortcut(shortcut, modifiers: modifiers)
    }

    private func shortcutLabel(_ shortcut: KeyEquivalent, modifiers: EventModifiers) -> String {
        let command = modifiers.contains(.command) ? "⌘" : ""
        let shift = modifiers.contains(.shift) ? "⇧" : ""
        return command + shift + String(shortcut.character).uppercased()
    }

    private func canMove(by offset: Int) -> Bool {
        guard let currentId, let index = items.firstIndex(where: { $0.id == currentId }) else {
            return false
        }
        return items.indices.contains(index + offset)
    }

    private func moveCurrent(by offset: Int) {
        guard let currentId, let index = items.firstIndex(where: { $0.id == currentId }) else { return }
        let destination = index + offset
        guard items.indices.contains(destination) else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            self.currentId = items[destination].id
        }
    }

    private func toggleRead(_ item: RiverItem) {
        Task {
            if model.river.isUnread(item) {
                await model.river.markRead(item)
            } else {
                await model.river.markUnread(item)
            }
        }
    }

    @ViewBuilder
    private func safetyActions(for item: RiverItem) -> some View {
        Button {
            reportItem = item
        } label: {
            Label("Report content", systemImage: "exclamationmark.bubble")
        }

        if item.authorID != nil {
            Button(role: .destructive) {
                blockCandidate = item
            } label: {
                Label("Block author", systemImage: "person.badge.minus")
            }
        }

        Button {
            showSafetyPolicy = true
        } label: {
            Label("River safety and support", systemImage: "shield")
        }
    }

    private func block(_ item: RiverItem) {
        blockCandidate = nil
        Task {
            if await model.river.blockAuthor(of: item) {
                toast.show("Author blocked on this device", symbol: "person.badge.minus")
                if presentation == .fullScreen { dismiss() }
            } else {
                toast.show("Couldn’t block author", symbol: "exclamationmark.triangle")
            }
        }
    }

    private var currentItem: RiverItem? {
        items.first { $0.id == currentId }
    }
}

private extension Image {
    func controlIconStyle() -> some View {
        self
            .font(.system(size: 15, weight: .semibold))
            .frame(width: 38, height: 38)
            .background(.regularMaterial, in: Circle())
    }
}

struct RiverPageView: View {
    let item: RiverItem
    var topInset: CGFloat = 60
    var bottomInset: CGFloat = 120
    var allowsPullToDismiss = true

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @State private var pulledToDismiss = false

    private var styling: MarkdownStyling {
        MarkdownStyling(
            typography: model.settings.typography,
            textColor: Theme.text(colorScheme),
            mutedColor: Theme.textMuted(colorScheme),
            accentColor: Theme.accent(model.settings.accentPreset, colorScheme)
        )
    }

    /// The page already shows the title as a headline; drop a leading H1
    /// that just repeats it.
    private var bodyContent: String {
        let stripped = MarkdownParser.stripFrontmatter(item.content)
        var lines = stripped.components(separatedBy: "\n")
        if let first = lines.first?.trimmingCharacters(in: .whitespaces),
           first.hasPrefix("# "),
           first.dropFirst(2).trimmingCharacters(in: .whitespaces).caseInsensitiveCompare(item.title) == .orderedSame {
            lines.removeFirst()
        }
        return lines.joined(separator: "\n").trimmingCharacters(in: .newlines)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    CallsignBadge(
                        callsign: item.authorCallsign ?? item.authorInitials ?? "FT",
                        accent: Theme.accent(model.settings.accentPreset, colorScheme)
                    )
                    Spacer()
                    Text(item.updatedAtMs.msToDate.relativeShort)
                        .font(.system(size: 12))
                        .foregroundStyle(.tertiary)
                }
                .padding(.top, topInset)

                Text(item.title)
                    .font(.custom("Source Serif 4", size: styling.typography.h1Size + 6).weight(.semibold))
                    .foregroundStyle(Theme.text(colorScheme))

                MarkdownView(
                    blocks: MarkdownParser.parse(bodyContent, styling: styling),
                    styling: styling,
                    lazy: true
                )
                .padding(.top, 4)
            }
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 22)
            .padding(.bottom, bottomInset)
        }
        .scrollIndicators(.hidden)
        // One firm pull past the top closes the reader.
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
            geometry.contentOffset.y + geometry.contentInsets.top
        } action: { _, offset in
            if allowsPullToDismiss, offset < -70, !pulledToDismiss {
                pulledToDismiss = true
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                dismiss()
            }
        }
    }
}
