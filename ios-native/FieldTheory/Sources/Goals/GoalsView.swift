import SwiftUI

struct GoalsView: View {
    @Binding var showSettings: Bool
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme
    @Environment(ToastCenter.self) private var toast

    @State private var selectedProject: GoalProject?
    @State private var feedCards: [GoalCard] = []
    @State private var currentIndex = 0
    @State private var contextCard: GoalCard?
    @State private var detailCard: GoalCard?

    var body: some View {
        NavigationStack {
            Group {
                if feedCards.isEmpty {
                    emptyState
                } else {
                    feed
                }
            }
            .navigationTitle("Goals")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { projectMenu }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            UIPasteboard.general.string = model.goals.exportFeedbackJSON()
                            toast.show("Feedback copied", symbol: "square.and.arrow.up")
                        } label: {
                            Label("Copy feedback JSON", systemImage: "square.and.arrow.up")
                        }
                        Button { showSettings = true } label: {
                            Label("Settings", systemImage: "gearshape")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .background(Theme.background(colorScheme))
        }
        .task { await reloadFeed() }
        .sheet(item: $contextCard) { card in
            GoalContextSheet(card: card) { action, context in
                await record(card, action: action, context: context)
            }
            .presentationDetents([.height(260)])
        }
        .sheet(item: $detailCard) { card in
            GoalDetailSheet(card: card)
        }
    }

    // MARK: - Feed

    private var feed: some View {
        Group {
            if let card = currentCard {
                GoalJudgmentSwipeRow(
                    onSwipeRight: { Task { await record(card, action: .useful, context: nil) } },
                    onSwipeLeft: { Task { await record(card, action: .notUseful, context: nil) } },
                    onSwipeUp: { advanceDeck(by: 1) },
                    onSwipeDown: { advanceDeck(by: -1) },
                    canSwipeUp: currentIndex < feedCards.count - 1,
                    canSwipeDown: currentIndex > 0
                ) {
                    GoalCardPage(
                        card: card,
                        judgment: judgment(for: card),
                        pursued: model.goals.pursuedCardIds.contains(card.id),
                        position: position(of: card),
                        onUseful: { Task { await record(card, action: .useful, context: nil) } },
                        onNotUseful: { Task { await record(card, action: .notUseful, context: nil) } },
                        onContext: { contextCard = card },
                        onPursue: { Task { await pursue(card) } },
                        onOpen: { detailCard = card }
                    )
                }
                .id(card.id)
                .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .background(Theme.background(colorScheme))
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "scope")
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(Theme.textMuted(colorScheme))
            Text("All caught up")
                .font(.custom("Source Serif 4", size: 20).weight(.medium))
            Text("\(model.goals.feedback.count) judgments / algorithm \(model.goals.algorithmVersion)")
                .font(.custom("Source Sans 3", size: 15))
                .foregroundStyle(Theme.textMuted(colorScheme))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background(colorScheme))
    }

    private var projectMenu: some View {
        Menu {
            Picker("Project", selection: $selectedProject) {
                Text("All projects").tag(GoalProject?.none)
                ForEach(GoalProject.allCases) { project in
                    Text(project.displayName).tag(GoalProject?.some(project))
                }
            }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "folder")
                    .font(.system(size: 12, weight: .semibold))
                Text(selectedProject?.displayName ?? "All projects")
                    .font(.system(size: 14, weight: .semibold))
            }
            .foregroundStyle(Theme.accent(model.settings.accentPreset, colorScheme))
        }
        .onChange(of: selectedProject) {
            currentIndex = 0
            Task { await reloadFeed() }
        }
    }

    // MARK: - Actions

    private func reloadFeed() async {
        await model.goals.reload()
        refreshFeed()
    }

    private func judgment(for card: GoalCard) -> GoalFeedbackAction? {
        model.goals.feedback
            .first { $0.cardId == card.id && $0.action != GoalFeedbackAction.pursued.rawValue }
            .flatMap { GoalFeedbackAction(rawValue: $0.action) }
    }

    private func position(of card: GoalCard) -> String {
        let index = feedCards.firstIndex(of: card).map { $0 + 1 } ?? 0
        return "\(index)/\(feedCards.count)"
    }

    private var currentCard: GoalCard? {
        guard feedCards.indices.contains(currentIndex) else { return feedCards.first }
        return feedCards[currentIndex]
    }

    private func record(_ card: GoalCard, action: GoalFeedbackAction, context: String?) async {
        guard judgment(for: card) == nil else { return }
        await model.goals.record(card: card, action: action, context: context)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        withAnimation(.spring(response: 0.45, dampingFraction: 0.86)) {
            refreshFeed()
        }
    }

    private func pursue(_ card: GoalCard) async {
        await model.goals.record(card: card, action: .pursued)
        UIPasteboard.general.string = card.goal
        toast.show("Goal copied", symbol: "flag.checkered")
    }

    private func refreshFeed() {
        feedCards = model.goals.unjudgedCards(for: selectedProject)
        currentIndex = min(max(0, currentIndex), max(0, feedCards.count - 1))
    }

    private func advanceDeck(by delta: Int) {
        let nextIndex = min(max(0, currentIndex + delta), max(0, feedCards.count - 1))
        guard nextIndex != currentIndex else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(.spring(response: 0.32, dampingFraction: 0.84)) {
            currentIndex = nextIndex
        }
    }
}

// MARK: - Card page

struct GoalJudgmentSwipeRow<Content: View>: View {
    let onSwipeRight: () -> Void
    let onSwipeLeft: () -> Void
    let onSwipeUp: () -> Void
    let onSwipeDown: () -> Void
    let canSwipeUp: Bool
    let canSwipeDown: Bool
    @ViewBuilder let content: () -> Content

    @State private var offset: CGSize = .zero
    @State private var dragAxis: DragAxis?

    private enum DragAxis {
        case horizontal
        case vertical
    }

    private let intentDistance: CGFloat = 18
    private let commitDistance: CGFloat = 58

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                reveal
                content()
                    .offset(offset)
            }
            .contentShape(Rectangle())
            .gesture(dragGesture(width: geometry.size.width))
        }
    }

    private func dragGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 8, coordinateSpace: .global)
            .onChanged { value in
                guard !startedAtScreenEdge(value, width: width) else { return }
                updateAxisIfNeeded(value)
                switch dragAxis {
                case .horizontal:
                    offset = CGSize(width: damped(value.translation.width, commitDistance: commitDistance), height: 0)
                case .vertical:
                    offset = CGSize(width: 0, height: damped(value.translation.height, commitDistance: commitDistance))
                case nil:
                    break
                }
            }
            .onEnded { value in
                defer {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
                        offset = .zero
                    }
                    dragAxis = nil
                }

                guard !startedAtScreenEdge(value, width: width) else { return }

                switch dragAxis {
                case .horizontal:
                    let projected = value.translation.width + value.predictedEndTranslation.width * 0.3
                    guard abs(projected) > commitDistance,
                          abs(projected) > abs(value.translation.height) * 1.25 else { return }
                    if projected > 0 {
                        onSwipeRight()
                    } else {
                        onSwipeLeft()
                    }
                case .vertical:
                    let projected = value.translation.height + value.predictedEndTranslation.height * 0.3
                    guard abs(projected) > commitDistance,
                          abs(projected) > abs(value.translation.width) * 1.25 else { return }
                    if projected < 0, canSwipeUp {
                        onSwipeUp()
                    } else if projected > 0, canSwipeDown {
                        onSwipeDown()
                    }
                case nil:
                    break
                }
            }
    }

    private func damped(_ distance: CGFloat, commitDistance: CGFloat) -> CGFloat {
        let past = max(0, abs(distance) - commitDistance)
        let value = min(abs(distance), commitDistance) + past * 0.3
        return (distance < 0 ? -1 : 1) * value
    }

    private func updateAxisIfNeeded(_ value: DragGesture.Value) {
        guard dragAxis == nil else { return }
        let dx = abs(value.translation.width)
        let dy = abs(value.translation.height)
        guard max(dx, dy) >= intentDistance else { return }

        if dx > dy * 1.25 {
            dragAxis = .horizontal
        } else if dy > dx * 1.05 {
            dragAxis = .vertical
        }
    }

    private func startedAtScreenEdge(_ value: DragGesture.Value, width: CGFloat) -> Bool {
        return value.startLocation.x < EdgeSwipe.zoneWidth
            || value.startLocation.x > width - EdgeSwipe.zoneWidth
    }

    private var reveal: some View {
        let horizontalOffset = offset.width
        let committed = abs(horizontalOffset) >= commitDistance
        return HStack {
            Label("Useful", systemImage: "hand.thumbsup.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.leading, 22)
                .opacity(horizontalOffset > 10 ? 1 : 0)
                .scaleEffect(horizontalOffset > 0 && committed ? 1.08 : 1)
            Spacer()
            Label("Not useful", systemImage: "hand.thumbsdown.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.trailing, 22)
                .opacity(horizontalOffset < -10 ? 1 : 0)
                .scaleEffect(horizontalOffset < 0 && committed ? 1.08 : 1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(horizontalOffset > 0 ? Theme.markRead : Theme.unread)
                .opacity(abs(horizontalOffset) > 10 ? (committed ? 1 : 0.75) : 0)
        )
        .animation(.easeOut(duration: 0.12), value: committed)
    }
}

struct GoalCardPage: View {
    let card: GoalCard
    let judgment: GoalFeedbackAction?
    let pursued: Bool
    let position: String
    let onUseful: () -> Void
    let onNotUseful: () -> Void
    let onContext: () -> Void
    let onPursue: () -> Void
    let onOpen: () -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme

    private var accent: Color { Theme.accent(model.settings.accentPreset, colorScheme) }
    private let bottomChromeHeight: CGFloat = 116

    var body: some View {
        GeometryReader { geometry in
            cardSurface
                .frame(
                    width: max(0, geometry.size.width - 24),
                    height: min(max(0, geometry.size.height - 10), 720),
                    alignment: .topLeading
                )
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(alignment: .topTrailing) { judgmentBadge.padding(26) }
                .contentShape(Rectangle())
                .onTapGesture { onOpen() }
                .padding(.horizontal, 12)
                .padding(.top, 8)
        }
    }

    private var cardSurface: some View {
        GeometryReader { geometry in
            let contentHeight = max(0, geometry.size.height - bottomChromeHeight)
            VStack(alignment: .leading, spacing: 10) {
                fittedContent
                    .frame(maxWidth: .infinity, minHeight: contentHeight, maxHeight: contentHeight, alignment: .topLeading)
                    .clipped()
                ScoreAxesView(scores: card.scores)
                    .layoutPriority(2)
                actionBar
                    .layoutPriority(3)
            }
            .padding(16)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Theme.backgroundAlt(colorScheme))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .strokeBorder(judgmentBorder, lineWidth: 1.5)
                    )
            )
        }
    }

    private var fittedContent: some View {
        ViewThatFits(in: .vertical) {
            contentVariant(
                titleSize: 21,
                bodySize: 14,
                labelSize: 10,
                spacing: 9,
                titleLimit: 2,
                whyLimit: nil,
                goalLimit: nil,
                firstTestLimit: nil
            )
            contentVariant(
                titleSize: 20,
                bodySize: 13,
                labelSize: 9.5,
                spacing: 7,
                titleLimit: 2,
                whyLimit: nil,
                goalLimit: nil,
                firstTestLimit: nil
            )
            contentVariant(
                titleSize: 18.5,
                bodySize: 12.5,
                labelSize: 9,
                spacing: 6,
                titleLimit: 2,
                whyLimit: nil,
                goalLimit: nil,
                firstTestLimit: nil
            )
            contentVariant(
                titleSize: 18,
                bodySize: 12.5,
                labelSize: 8.5,
                spacing: 6,
                titleLimit: 1,
                whyLimit: 5,
                goalLimit: 12,
                firstTestLimit: 3
            )
        }
    }

    private func contentVariant(
        titleSize: CGFloat,
        bodySize: CGFloat,
        labelSize: CGFloat,
        spacing: CGFloat,
        titleLimit: Int,
        whyLimit: Int?,
        goalLimit: Int?,
        firstTestLimit: Int?
    ) -> some View {
        VStack(alignment: .leading, spacing: spacing) {
            header
            Text(card.title)
                .font(.custom("Source Serif 4", size: titleSize).weight(.semibold))
                .foregroundStyle(Theme.text(colorScheme))
                .lineLimit(titleLimit)

            sourceRow

            section("Why now", card.whyNow, bodySize: bodySize, labelSize: labelSize, lineLimit: whyLimit)
            section("Goal", card.goal, bodySize: bodySize, labelSize: labelSize, lineLimit: goalLimit)
            section("First test", card.firstTest, bodySize: bodySize, labelSize: labelSize, lineLimit: firstTestLimit)
        }
    }

    private var judgmentBorder: Color {
        switch judgment {
        case .useful: return Theme.markRead.opacity(0.6)
        case .notUseful: return Theme.unread.opacity(0.5)
        default: return Theme.border(colorScheme)
        }
    }

    @ViewBuilder
    private var judgmentBadge: some View {
        switch judgment {
        case .useful:
            Image(systemName: "hand.thumbsup.fill").foregroundStyle(Theme.markRead)
        case .notUseful:
            Image(systemName: "hand.thumbsdown.fill").foregroundStyle(Theme.unread)
        default:
            EmptyView()
        }
    }

    private var header: some View {
        HStack(spacing: 7) {
            chip(card.project, tint: accent)
            chip("algorithm \(card.algorithmVersion)", tint: Theme.textMuted(colorScheme))
            Spacer()
            Text(position)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(.tertiary)
        }
    }

    private func chip(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold, design: .monospaced))
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(tint.opacity(0.12), in: Capsule())
    }

    private var sourceRow: some View {
        HStack(spacing: 6) {
            Image(systemName: "bookmark.fill")
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
            Text("@\(card.source.authorHandle ?? "unknown")")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textMuted(colorScheme))
            Text(card.source.excerpt)
                .font(.custom("Source Sans 3", size: 13))
                .foregroundStyle(.tertiary)
                .lineLimit(1)
        }
    }

    private func section(_ label: String, _ text: String, bodySize: CGFloat, labelSize: CGFloat, lineLimit: Int?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.system(size: labelSize, weight: .bold))
                .foregroundStyle(.tertiary)
                .kerning(0.8)
            Text(text)
                .font(.custom("Source Sans 3", size: bodySize))
                .foregroundStyle(Theme.text(colorScheme))
                .lineSpacing(1.5)
                .lineLimit(lineLimit)
        }
    }

    private var actionBar: some View {
        HStack(spacing: 12) {
            judgeButton("hand.thumbsdown", tint: Theme.unread, action: onNotUseful)
            judgeButton("hand.thumbsup", tint: Theme.markRead, action: onUseful)
            Button(action: onContext) {
                Image(systemName: "text.bubble")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(Theme.textMuted(colorScheme))
                    .frame(width: 46, height: 46)
                    .background(Theme.background(colorScheme), in: Circle())
            }
            .buttonStyle(.plain)
            Spacer()
            Button(action: onPursue) {
                HStack(spacing: 6) {
                    Image(systemName: pursued ? "flag.checkered" : "flag")
                    Text(pursued ? "Pursuing" : "Pursue")
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 18)
                .frame(height: 46)
                .background(accent, in: Capsule())
            }
            .buttonStyle(.plain)
        }
    }

    private func judgeButton(_ symbol: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(judgment == nil ? tint : tint.opacity(0.3))
                .frame(width: 46, height: 46)
                .background(Theme.background(colorScheme), in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(judgment != nil)
    }
}

// MARK: - Score axes

struct ScoreAxesView: View {
    let scores: GoalCard.Scores
    @Environment(\.colorScheme) private var colorScheme

    private var axes: [(String, Double)] {
        [("rel", scores.relevance), ("act", scores.actionability),
         ("nov", scores.novelty), ("lev", scores.leverage),
         ("tim", scores.timing), ("evi", scores.evidence),
         ("con", scores.confidence), ("cost", scores.cost)]
    }

    var body: some View {
        HStack(spacing: 8) {
            ForEach(axes, id: \.0) { name, value in
                VStack(spacing: 3) {
                    Capsule()
                        .fill(Theme.border(colorScheme))
                        .frame(width: 22, height: 4)
                        .overlay(alignment: .leading) {
                            Capsule()
                                .fill(name == "cost" ? Theme.unread.opacity(0.7) : Theme.textMuted(colorScheme))
                                .frame(width: 22 * value, height: 4)
                        }
                    Text(name)
                        .font(.system(size: 8.5, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }
}

// MARK: - Context sheet

struct GoalContextSheet: View {
    let card: GoalCard
    let onSubmit: (GoalFeedbackAction, String?) async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @State private var context = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(card.title)
                .font(.custom("Source Serif 4", size: 17).weight(.medium))
                .lineLimit(2)
            TextField("Why? (optional)", text: $context, axis: .vertical)
                .font(.custom("Source Sans 3", size: 15))
                .lineLimit(2...4)
                .padding(10)
                .background(Theme.backgroundAlt(colorScheme), in: RoundedRectangle(cornerRadius: 10))
                .focused($focused)
            HStack(spacing: 10) {
                submitButton("Not useful", symbol: "hand.thumbsdown", tint: Theme.unread, action: .notUseful)
                submitButton("Useful", symbol: "hand.thumbsup", tint: Theme.markRead, action: .useful)
            }
        }
        .padding(20)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Theme.background(colorScheme))
        .onAppear { focused = true }
    }

    private func submitButton(_ label: String, symbol: String, tint: Color, action: GoalFeedbackAction) -> some View {
        Button {
            let text = context.trimmingCharacters(in: .whitespacesAndNewlines)
            Task { await onSubmit(action, text.isEmpty ? nil : text) }
            dismiss()
        } label: {
            Label(label, systemImage: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(tint, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Detail sheet

struct GoalDetailSheet: View {
    let card: GoalCard
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(card.title)
                        .font(.custom("Source Serif 4", size: 24).weight(.semibold))

                    VStack(alignment: .leading, spacing: 6) {
                        Text("@\(card.source.authorHandle ?? "unknown")\(card.source.authorName.map { " - \($0)" } ?? "")")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textMuted(colorScheme))
                        Text(card.source.excerpt)
                            .font(.custom("Source Sans 3", size: 14))
                            .foregroundStyle(Theme.textMuted(colorScheme))
                        if let url = URL(string: card.source.url) {
                            Link("Open on X", destination: url)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.link)
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.backgroundAlt(colorScheme), in: RoundedRectangle(cornerRadius: 12))

                    detailSection("Why now", card.whyNow)
                    detailSection("Goal", card.goal)
                    detailSection("First test", card.firstTest)

                    ScoreAxesView(scores: card.scores)
                    Text(card.scoreNote)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(.tertiary)

                    Button {
                        UIPasteboard.general.string = card.goal
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        Label("Copy goal paragraph", systemImage: "doc.on.doc")
                            .font(.system(size: 15, weight: .semibold))
                    }
                    .buttonStyle(.bordered)
                }
                .padding(20)
            }
            .background(Theme.background(colorScheme))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func detailSection(_ label: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.tertiary)
                .kerning(0.8)
            Text(text)
                .font(.custom("Source Sans 3", size: 16))
                .lineSpacing(3.5)
                .textSelection(.enabled)
        }
    }
}
