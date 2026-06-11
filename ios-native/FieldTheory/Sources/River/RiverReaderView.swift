import SwiftUI

/// Full-screen reading: swipe horizontally to move between river items,
/// scroll vertically inside an item. Dwelling on a card marks it read.
struct RiverReaderView: View {
    let items: [RiverItem]
    let startAt: RiverItem

    @Environment(AppModel.self) private var model
    @Environment(ToastCenter.self) private var toast
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    @State private var currentId: String?

    var body: some View {
        TabView(selection: $currentId) {
            ForEach(items) { item in
                RiverPageView(item: item)
                    .tag(Optional(item.id))
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .ignoresSafeArea(edges: .bottom)
        .background(Theme.background(colorScheme))
        .overlay(alignment: .topTrailing) { controls }
        .onAppear { currentId = startAt.id }
        .onChange(of: currentId) { _, id in
            guard let id, let item = items.first(where: { $0.id == id }) else { return }
            Task { await model.river.markRead(item) }
        }
    }

    private var controls: some View {
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
                            await model.transcripts.addFileSegment(fileName: item.fileName, content: item.content, into: nil)
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
                } label: {
                    Image(systemName: "ellipsis")
                        .controlIconStyle()
                }
            }
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .controlIconStyle()
            }
        }
        .padding(.trailing, 18)
        .padding(.top, 8)
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
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme

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
                .padding(.top, 60)

                Text(item.title)
                    .font(.custom("Source Serif 4", size: styling.typography.h1Size + 6).weight(.semibold))
                    .foregroundStyle(Theme.text(colorScheme))

                MarkdownView(
                    blocks: MarkdownParser.parse(bodyContent, styling: styling),
                    styling: styling
                )
                .padding(.top, 4)
            }
            .frame(maxWidth: 680, alignment: .leading)
            .padding(.horizontal, 22)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
    }
}
