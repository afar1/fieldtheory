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
        ScrollView {
            LazyVStack(spacing: 14) {
                ForEach(model.river.items) { item in
                    SwipeToTriageRow(
                        onSwipeRight: { Task { await model.river.markRead(item) } },
                        onSwipeLeft: { Task { await model.river.markUnread(item) } }
                    ) {
                        RiverCardView(item: item, unread: model.river.isUnread(item))
                            .contentShape(Rectangle())
                            .onTapGesture { openedItem = item }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
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

/// Mailbox-feel triage swipe: a short, velocity-assisted throw commits —
/// right marks read (green), left marks unread (red). Rubber-bands past the
/// commit point and springs home.
struct SwipeToTriageRow<Content: View>: View {
    let onSwipeRight: () -> Void
    let onSwipeLeft: () -> Void
    @ViewBuilder let content: () -> Content

    @State private var offset: CGFloat = 0
    private let commitDistance: CGFloat = 64

    var body: some View {
        ZStack {
            reveal
            content()
                .offset(x: offset)
        }
        .gesture(
            DragGesture(minimumDistance: 14, coordinateSpace: .global)
                .onChanged { value in
                    guard !startedAtScreenEdge(value) else { return }
                    let dx = value.translation.width
                    guard abs(dx) > abs(value.translation.height) else { return }
                    // Ease off past the commit point so it feels weighted.
                    let past = max(0, abs(dx) - commitDistance)
                    let damped = min(abs(dx), commitDistance) + past * 0.35
                    offset = (dx < 0 ? -1 : 1) * damped
                }
                .onEnded { value in
                    guard !startedAtScreenEdge(value) else { return }
                    // A flick counts: blend actual travel with projected end.
                    let projected = value.translation.width + value.predictedEndTranslation.width * 0.25
                    if projected > commitDistance {
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        onSwipeRight()
                    } else if projected < -commitDistance {
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        onSwipeLeft()
                    }
                    withAnimation(.spring(response: 0.32, dampingFraction: 0.8)) {
                        offset = 0
                    }
                }
        )
    }

    /// Drags born in the edge strips belong to tab navigation, not the card.
    private func startedAtScreenEdge(_ value: DragGesture.Value) -> Bool {
        let width = UIScreen.main.bounds.width
        return value.startLocation.x < EdgeSwipe.zoneWidth
            || value.startLocation.x > width - EdgeSwipe.zoneWidth
    }

    private var reveal: some View {
        let committed = abs(offset) >= commitDistance
        return HStack {
            Label("Read", systemImage: "envelope.open")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.leading, 22)
                .opacity(offset > 10 ? 1 : 0)
                .scaleEffect(offset > 0 && committed ? 1.08 : 1)
            Spacer()
            Label("Unread", systemImage: "envelope.badge")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.trailing, 22)
                .opacity(offset < -10 ? 1 : 0)
                .scaleEffect(offset < 0 && committed ? 1.08 : 1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(offset > 0 ? Theme.markRead : Theme.unread)
                .opacity(abs(offset) > 10 ? (committed ? 1 : 0.75) : 0)
        )
        .animation(.easeOut(duration: 0.12), value: committed)
    }
}

/// A generous preview card: callsign top-left, freshness top-right, title,
/// and the opening lines of the document.
struct RiverCardView: View {
    let item: RiverItem
    let unread: Bool
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme

    private var preview: String { item.preview }

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
