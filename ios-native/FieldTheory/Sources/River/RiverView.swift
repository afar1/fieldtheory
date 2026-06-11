import SwiftUI

struct RiverView: View {
    @Binding var showSettings: Bool
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme

    @State private var openedItem: RiverItem?

    var body: some View {
        NavigationStack {
            Group {
                if model.river.items.isEmpty {
                    emptyState
                } else {
                    list
                }
            }
            .navigationTitle("River")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
        }
        .fullScreenCover(item: $openedItem) { item in
            RiverReaderView(items: model.river.items, startAt: item)
        }
        .task {
            if model.launchDirectives.contains("ft-open-river") {
                try? await Task.sleep(nanoseconds: 600_000_000)
                openedItem = model.river.items.first
            }
        }
    }

    private var list: some View {
        List {
            ForEach(model.river.items) { item in
                RiverCardView(item: item, unread: model.river.isUnread(item))
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 7, leading: 16, bottom: 7, trailing: 16))
                    .listRowBackground(Color.clear)
                    .contentShape(Rectangle())
                    .onTapGesture { openedItem = item }
                    // The Mailbox grammar: swipe right → green, mark read;
                    // swipe left → red, back to unread.
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        if model.river.isUnread(item) {
                            Button {
                                Task { await model.river.markRead(item) }
                            } label: {
                                Label("Read", systemImage: "envelope.open")
                            }
                            .tint(Theme.markRead)
                        } else {
                            Button {
                                Task { await model.river.markUnread(item) }
                            } label: {
                                Label("Unread", systemImage: "envelope.badge")
                            }
                            .tint(Theme.unread)
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button {
                            Task { await model.river.markUnread(item) }
                        } label: {
                            Label("Unread", systemImage: "envelope.badge")
                        }
                        .tint(Theme.unread)
                    }
                    .contextMenu {
                        Button {
                            UIPasteboard.general.string = item.clipboardText
                        } label: {
                            Label("Copy", systemImage: "doc.on.doc")
                        }
                        Button {
                            Task {
                                await model.transcripts.addFileSegment(fileName: item.fileName, content: item.content, into: nil)
                            }
                        } label: {
                            Label("Add to Voice stack", systemImage: "square.stack.3d.up")
                        }
                    }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.background(colorScheme))
        .refreshable { await model.sync.syncNow() }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "water.waves")
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(Theme.textMuted(colorScheme))
            Text(model.river.available ? "The river is quiet" : "No team yet")
                .font(.custom("Source Serif 4", size: 20).weight(.medium))
            Text(model.river.available
                 ? "Documents your team shares to River show up here."
                 : "Join or create a team in the Mac app, then pull to refresh.")
                .font(.custom("Source Sans 3", size: 15))
                .foregroundStyle(Theme.textMuted(colorScheme))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background(colorScheme))
        .refreshableScroll { await model.sync.refreshTeamScope() }
    }
}

/// A generous preview card: callsign top-left, freshness top-right, title,
/// and the opening lines of the document.
struct RiverCardView: View {
    let item: RiverItem
    let unread: Bool
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme

    private var preview: String {
        let stripped = MarkdownParser.stripFrontmatter(item.content)
        let lines = stripped.components(separatedBy: "\n")
            .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("#") }
            .map { line -> String in
                line.replacingOccurrences(of: "^\\s*([-*+]|\\d+\\.)\\s+(\\[[ xX]\\]\\s*)?", with: "", options: .regularExpression)
                    .replacingOccurrences(of: "[*_`>]", with: "", options: .regularExpression)
            }
        return String(lines.joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .prefix(360))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                CallsignBadge(
                    callsign: item.authorCallsign ?? item.authorInitials ?? "FT",
                    accent: Theme.accent(model.settings.accentPreset, colorScheme)
                )
                Spacer()
                if unread { UnreadDot() }
                Text(item.updatedAtMs.msToDate.relativeShort)
                    .font(.system(size: 12))
                    .foregroundStyle(.tertiary)
            }

            Text(item.title)
                .font(.custom("Source Serif 4", size: 20).weight(unread ? .semibold : .medium))
                .foregroundStyle(Theme.text(colorScheme))
                .lineLimit(2)

            Text(preview)
                .font(.custom("Source Sans 3", size: 15))
                .foregroundStyle(Theme.textMuted(colorScheme))
                .lineLimit(5)
                .lineSpacing(3)

            HStack {
                Text(item.fileName)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                Spacer()
                Button {
                    UIPasteboard.general.string = item.clipboardText
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.textMuted(colorScheme))
                        .frame(width: 30, height: 30)
                        .background(Theme.background(colorScheme), in: Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(.top, 2)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Theme.backgroundAlt(colorScheme))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(unread ? Theme.unread.opacity(0.35) : Theme.border(colorScheme), lineWidth: 1)
                )
        )
    }
}

private extension View {
    /// Wraps a non-list view in a scroll view so pull-to-refresh works on
    /// empty states too.
    func refreshableScroll(action: @escaping () async -> Void) -> some View {
        ScrollView {
            self.frame(maxWidth: .infinity, minHeight: 480)
        }
        .refreshable { await action() }
    }
}
