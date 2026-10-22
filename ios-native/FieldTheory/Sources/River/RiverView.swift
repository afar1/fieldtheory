import SwiftUI

struct RiverView: View {
    @Binding var showSettings: Bool
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var openedItem: RiverItem?
    @State private var selectedItemID: String?
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var handledOpenDirective = false
    @State private var showSafetyPolicy = false
    @State private var search = ""
    @State private var sharedItem: RiverItem?
    @State private var copiedID: String?

    var body: some View {
        GeometryReader { geometry in
            let usesSplitLayout = shouldUseSplitLayout(width: geometry.size.width)

            Group {
                if usesSplitLayout {
                    regularWidthView
                } else {
                    compactView
                }
            }
            .task {
                reconcileSelection(selectFirstIfMissing: true, usesSplitLayout: usesSplitLayout)
                guard !handledOpenDirective,
                      model.launchDirectives.contains("ft-open-river") else { return }
                handledOpenDirective = true
                try? await Task.sleep(nanoseconds: 600_000_000)
                guard let first = model.river.items.first else { return }
                if usesSplitLayout {
                    selectedItemID = first.id
                } else {
                    openCompact(first)
                }
            }
            .onChange(of: model.river.items) { previous, _ in
                reconcileSelection(
                    selectFirstIfMissing: previous.isEmpty,
                    usesSplitLayout: usesSplitLayout
                )
            }
            .onChange(of: usesSplitLayout) { _, split in
                transition(toSplitLayout: split)
            }
        }
        .sheet(isPresented: $showSafetyPolicy) {
            RiverSafetyPolicyView()
        }
    }

    private var compactView: some View {
        NavigationStack {
            Group {
                if model.river.items.isEmpty {
                    emptyState
                } else {
                    compactList
                }
            }
            .navigationTitle("River")
            .searchable(text: $search)
            .toolbar { settingsToolbar }
        }
        .fullScreenCover(item: $openedItem) { item in
            RiverReaderView(
                items: model.river.items,
                startAt: item,
                selection: $selectedItemID
            )
        }
    }

    @ViewBuilder
    private var regularWidthView: some View {
        if model.river.items.isEmpty {
            NavigationStack {
                emptyState
                    .navigationTitle("River")
                    .toolbar { settingsToolbar }
            }
        } else {
            NavigationSplitView(columnVisibility: $columnVisibility) {
                regularList
                    .navigationTitle("River")
                    .toolbar { settingsToolbar }
                    .navigationSplitViewColumnWidth(min: 300, ideal: 360, max: 420)
            } detail: {
                if let item = selectedItem {
                    RiverReaderView(
                        items: model.river.items,
                        startAt: item,
                        selection: $selectedItemID,
                        presentation: .splitDetail
                    )
                } else {
                    readerPlaceholder
                }
            }
            .navigationSplitViewStyle(.balanced)
        }
    }

    @ToolbarContentBuilder
    private var settingsToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button { showSafetyPolicy = true } label: {
                Image(systemName: "shield")
            }
            .help("River safety and support")
            .accessibilityLabel("River safety and support")
            .accessibilityIdentifier("RiverSafetyButton")
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button { showSettings = true } label: {
                Image(systemName: "gearshape")
            }
            .keyboardShortcut(",", modifiers: .command)
            .help("Settings")
        }
    }

    private var filteredItems: [RiverItem] {
        model.river.items.filter { search.isEmpty || $0.content.localizedCaseInsensitiveContains(search) || $0.authorLabel.localizedCaseInsensitiveContains(search) }
    }

    private func dayLabel(_ date: Date) -> String {
        if Calendar.current.isDateInToday(date) { return "TODAY" }
        if Calendar.current.isDateInYesterday(date) { return "YESTERDAY" }
        return date.formatted(.dateTime.month(.abbreviated).day()).uppercased()
    }

    private var compactList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                if let error = model.river.connectionError {
                    Text(error).font(.caption).foregroundStyle(.secondary)
                }
                ForEach(Array(filteredItems.enumerated()), id: \.element.id) { index, item in
                    if index == 0 || !Calendar.current.isDate(item.updatedAtMs.msToDate, inSameDayAs: filteredItems[index - 1].updatedAtMs.msToDate) {
                        Text(dayLabel(item.updatedAtMs.msToDate))
                            .font(.system(size: 11, weight: .semibold)).tracking(1.2)
                            .foregroundStyle(Theme.textMuted(colorScheme)).padding(.vertical, 20)
                    }
                    RiverCardView(item: item, unread: false)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            copy(item)
                            copiedID = item.id
                        }
                        .overlay(alignment: .topTrailing) {
                            Button { sharedItem = item } label: {
                                Image(systemName: "square.and.arrow.up")
                                    .font(.system(size: 13, weight: .regular))
                                    .foregroundStyle(Theme.textMuted(colorScheme).opacity(0.6))
                                    .frame(width: 44, height: 44)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Share")
                            .padding(4)
                        }
                        .overlay(alignment: .bottomTrailing) {
                            if copiedID == item.id {
                                Text("Copied").font(.caption).foregroundStyle(Theme.accent(model.settings.accentPreset, colorScheme)).padding(12)
                            }
                        }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 120)
        }
        .background(Theme.background(colorScheme))
        .refreshable { model.river.requestRefresh() }
        .sheet(item: $sharedItem) { item in
            RiverShareSheet(text: item.content, sourceID: "river-" + item.id) { sharedItem = nil }
                .presentationDetents([.height(540), .large])
                .presentationDragIndicator(.visible)
        }
    }

    private var regularList: some View {
        List(selection: $selectedItemID) {
            ForEach(model.river.items) { item in
                RiverSidebarRow(
                    item: item,
                    unread: model.river.isUnread(item),
                    selected: selectedItemID == item.id,
                    onToggleRead: { toggleRead(item) }
                )
                .tag(item.id)
                .contextMenu {
                    Button { toggleRead(item) } label: {
                        Label(
                            model.river.isUnread(item) ? "Mark read" : "Mark unread",
                            systemImage: model.river.isUnread(item) ? "envelope.open" : "envelope.badge"
                        )
                    }
                    Button { copy(item) } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                }
                .swipeActions(edge: .leading, allowsFullSwipe: false) {
                    Button {
                        Task { await model.river.markRead(item) }
                    } label: {
                        Label("Read", systemImage: "envelope.open")
                    }
                    .tint(Theme.markRead)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button {
                        Task { await model.river.markUnread(item) }
                    } label: {
                        Label("Unread", systemImage: "envelope.badge")
                    }
                    .tint(Theme.unread)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.background(colorScheme))
        .refreshable { model.river.requestRefresh() }
    }

    private var readerPlaceholder: some View {
        ContentUnavailableView {
            Label("Select a document", systemImage: "doc.text")
        } description: {
            Text("Choose something from River to read it here.")
        }
        .background(Theme.background(colorScheme))
    }

    private var selectedItem: RiverItem? {
        guard let selectedItemID else { return nil }
        return model.river.items.first { $0.id == selectedItemID }
    }

    private func shouldUseSplitLayout(width: CGFloat) -> Bool {
        UIDevice.current.userInterfaceIdiom == .pad
            && horizontalSizeClass == .regular
            && width >= 700
    }

    private func openCompact(_ item: RiverItem) {
        selectedItemID = item.id
        openedItem = item
    }

    private func transition(toSplitLayout split: Bool) {
        if split {
            if selectedItemID == nil, let openedItem {
                selectedItemID = openedItem.id
            }
            openedItem = nil
            reconcileSelection(selectFirstIfMissing: true, usesSplitLayout: true)
        } else if let selectedItem {
            openCompact(selectedItem)
        }
    }

    private func reconcileSelection(selectFirstIfMissing: Bool, usesSplitLayout: Bool) {
        guard usesSplitLayout else { return }
        if let selectedItemID {
            if model.river.items.contains(where: { $0.id == selectedItemID }) {
                return
            }
            self.selectedItemID = nil
            return
        }
        if selectFirstIfMissing {
            selectedItemID = model.river.items.first?.id
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

    private func copy(_ item: RiverItem) {
        UIPasteboard.general.string = item.content
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "water.waves")
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(Theme.textMuted(colorScheme))
            Text("The river is quiet")
                .font(.custom("Source Sans 3", size: 20))
            Text(model.river.connectionError ?? "Things shared with you appear here.")
                .font(.custom("Source Sans 3", size: 15))
                .foregroundStyle(Theme.textMuted(colorScheme))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            if model.river.connectionError != nil {
                Button("Try again") { model.river.requestRefresh() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background(colorScheme))
        .refreshableScroll { model.river.requestRefresh() }
    }
}

/// A denser River row for the bounded iPad list column. Selection only changes
/// the persistent detail; read state changes through the dedicated control.
private struct RiverSidebarRow: View {
    let item: RiverItem
    let unread: Bool
    let selected: Bool
    let onToggleRead: () -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme

    private var primaryText: Color {
        selected ? Theme.background(colorScheme) : Theme.text(colorScheme)
    }

    private var secondaryText: Color {
        selected ? Theme.background(colorScheme).opacity(0.85) : Theme.textMuted(colorScheme)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 8) {
                    CallsignBadge(
                        callsign: item.authorCallsign ?? item.authorInitials ?? "FT",
                        accent: selected ? primaryText : Theme.accent(model.settings.accentPreset, colorScheme)
                    )
                    if unread { UnreadDot() }
                    Spacer(minLength: 4)
                    Text(item.updatedAtMs.msToDate.relativeShort)
                        .font(.system(size: 12))
                        .foregroundStyle(secondaryText)
                }

                Text(item.title)
                    .font(.custom("Source Serif 4", size: 18).weight(unread ? .semibold : .medium))
                    .foregroundStyle(primaryText)
                    .lineLimit(2)

                Text(item.preview)
                    .font(.custom("Source Sans 3", size: 14))
                    .foregroundStyle(secondaryText)
                    .lineLimit(3)
                    .lineSpacing(2)

                Text(item.fileName)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(secondaryText)
                    .lineLimit(1)
            }

            Button(action: onToggleRead) {
                Image(systemName: unread ? "envelope.open" : "envelope.badge")
                    .font(.system(size: 14, weight: .medium))
                    .frame(width: 32, height: 32)
                    .background(Theme.background(colorScheme), in: Circle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(unread ? Theme.markRead : Theme.unread)
            .hoverEffect(.lift)
            .help(unread ? "Mark read" : "Mark unread")
            .accessibilityLabel(unread ? "Mark read" : "Mark unread")
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .hoverEffect(.highlight)
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
        let width = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .bounds.width ?? UIScreen.main.bounds.width
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
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                Text(item.updatedAtMs.msToDate.formatted(date: .omitted, time: .shortened))
                    .font(.system(size: 12))
                Text(item.createdBy.lowercased() == model.auth.userId?.uuidString.lowercased() ? "You" : item.authorLabel)
                    .font(.system(size: 11, weight: .medium))
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Theme.textMuted(colorScheme).opacity(0.10), in: RoundedRectangle(cornerRadius: 5))
                Spacer(minLength: 44)
            }
            .foregroundStyle(Theme.textMuted(colorScheme))
            Text(item.content)
                .lineLimit(3)
                .font(.custom("Source Sans 3", size: 16))
                .foregroundStyle(Theme.text(colorScheme))
                .lineSpacing(4)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.background(colorScheme)))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.border(colorScheme), lineWidth: 0.5))
        .accessibilityHint("Copies text")
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
