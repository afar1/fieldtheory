import SwiftUI

private struct TranscriptDayGroup: Identifiable {
    let day: Date
    var items: [TranscriptItem]

    var id: Date { day }
}

struct VoiceView: View {
    @Binding var showSettings: Bool
    @Environment(AppModel.self) private var model
    @Environment(ToastCenter.self) private var toast
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var searchText = ""
    @State private var selectionMode = false
    @State private var selectedIds: Set<String> = []
    @State private var editingItem: TranscriptItem?
    @State private var expandedIds: Set<String> = []
    @State private var copiedId: String?
    @State private var copiedResetTask: Task<Void, Never>?

    private var items: [TranscriptItem] {
        guard !searchText.isEmpty else { return model.transcripts.items }
        return model.transcripts.items.filter { item in
            item.text.localizedCaseInsensitiveContains(searchText)
                || (item.segments ?? []).contains { $0.text.localizedCaseInsensitiveContains(searchText) }
        }
    }

    private var selectedItems: [TranscriptItem] {
        items.filter { selectedIds.contains($0.id) }
    }

    private var hasSelectedStack: Bool {
        selectedItems.contains(where: \.isStack)
    }

    private var isRegularWidth: Bool {
        horizontalSizeClass == .regular
    }

    private var deviceName: String {
        UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "phone"
    }

    private var dayGroups: [TranscriptDayGroup] {
        let calendar = Calendar.current
        return items.reduce(into: []) { groups, item in
            let day = calendar.startOfDay(for: item.createdAtMs.msToDate)
            if groups.last?.day == day {
                groups[groups.count - 1].items.append(item)
            } else {
                groups.append(TranscriptDayGroup(day: day, items: [item]))
            }
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isRegularWidth {
                    regularContent
                } else {
                    compactContent
                }
            }
            .background(Theme.background(colorScheme))
            .navigationTitle("Voice")
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .automatic))
            .refreshable { await model.sync.syncNow() }
            .toolbar {
                if isRegularWidth {
                    ToolbarItem(placement: .topBarTrailing) {
                        if selectionMode {
                            Button {
                                exitSelection()
                            } label: {
                                Label("Done", systemImage: "xmark")
                            }
                            .help("Finish selecting")
                        } else {
                            Button {
                                enterSelection()
                            } label: {
                                Label("Select", systemImage: "checkmark.circle")
                            }
                            .keyboardShortcut("a", modifiers: [.command, .shift])
                            .help("Select transcripts (Shift-Command-A)")
                            .disabled(items.isEmpty)
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: {
                        Image(systemName: "gearshape")
                    }
                    .keyboardShortcut(",", modifiers: .command)
                    .help("Settings")
                }
            }
            .sheet(item: $editingItem) { item in
                if isRegularWidth {
                    TranscriptEditSheet(item: item, regularWidth: true)
                        .presentationSizing(.form)
                } else {
                    TranscriptEditSheet(item: item)
                }
            }
        }
    }

    private var compactContent: some View {
        ZStack(alignment: .bottom) {
            Group {
                if model.transcripts.items.isEmpty {
                    emptyState
                } else {
                    compactList
                }
            }
            if selectionMode {
                selectionBar
            } else {
                recordBar
            }
        }
    }

    private var regularContent: some View {
        ZStack(alignment: .bottom) {
            Group {
                if model.transcripts.items.isEmpty {
                    regularEmptyState
                } else if items.isEmpty {
                    noSearchResults
                } else {
                    regularGrid
                }
            }

            if selectionMode {
                regularSelectionBar
            } else {
                regularRecordBar
            }
        }
    }

    private var compactList: some View {
        ScrollView {
            LazyVStack(spacing: 12, pinnedViews: []) {
                if shouldShowRecorderStatus {
                    recorderStatusBanner
                }
                if case .downloading(let progress) = model.recorder.models.state {
                    modelBanner(progress: progress)
                }
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    if showsDateHeader(at: index) {
                        Text(Self.dateHeader(for: item.createdAtMs))
                            .font(.system(size: 12, weight: .semibold))
                            .tracking(0.6)
                            .textCase(.uppercase)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, index == 0 ? 4 : 10)
                    }
                    transcriptCard(item, wideLayout: false)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 150)
        }
        .scrollIndicators(.hidden)
    }

    private var regularGrid: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                VStack(spacing: 10) {
                    if shouldShowRecorderStatus {
                        recorderStatusBanner
                    }
                    if case .downloading(let progress) = model.recorder.models.state {
                        modelBanner(progress: progress)
                    }
                }

                ForEach(dayGroups) { group in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(Self.dateHeader(for: group.items[0].createdAtMs))
                            .font(.system(size: 12, weight: .semibold))
                            .tracking(0.6)
                            .textCase(.uppercase)
                            .foregroundStyle(.secondary)

                        LazyVGrid(columns: regularGridColumns, alignment: .leading, spacing: 16) {
                            ForEach(group.items) { item in
                                transcriptCard(item, wideLayout: true)
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: 1380, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.top, 12)
            .padding(.bottom, 118)
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.visible)
    }

    private var regularGridColumns: [GridItem] {
        [GridItem(.adaptive(minimum: 340, maximum: 460), spacing: 16, alignment: .top)]
    }

    private func transcriptCard(_ item: TranscriptItem, wideLayout: Bool) -> some View {
        StackCard(
            item: item,
            expanded: expandedIds.contains(item.id),
            copied: copiedId == item.id,
            selected: selectedIds.contains(item.id),
            selectionMode: selectionMode,
            wideLayout: wideLayout,
            onTap: { handleTap(item) },
            onCopy: { copy(item) },
            onEdit: { editingItem = item },
            onSelect: { enterSelection(with: item) },
            onToggleExpand: { toggleExpanded(item) },
            onUnstack: {
                Task { await model.transcripts.unstack(item) }
                toast.show("Unstacked", symbol: "square.stack.3d.down.right")
            }
        )
    }

    private func showsDateHeader(at index: Int) -> Bool {
        guard index > 0 else { return true }
        let calendar = Calendar.current
        let current = items[index].createdAtMs.msToDate
        let previous = items[index - 1].createdAtMs.msToDate
        return !calendar.isDate(current, inSameDayAs: previous)
    }

    static func dateHeader(for ms: Int64) -> String {
        let date = ms.msToDate
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE, MMM d"
        return formatter.string(from: date)
    }

    private func modelBanner(progress: Double) -> some View {
        HStack(spacing: 10) {
            ProgressView(value: progress)
                .frame(maxWidth: .infinity)
            Text("Downloading speech model \(Int(progress * 100))%")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize()
        }
        .padding(12)
        .background(Theme.backgroundAlt(colorScheme), in: RoundedRectangle(cornerRadius: 12))
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            if shouldShowRecorderStatus {
                recorderStatusBanner
                    .padding(.horizontal, 16)
                    .padding(.bottom, 10)
            }
            Image(systemName: "waveform")
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(Theme.textMuted(colorScheme))
            Text("Talk to your \(deviceName)")
                .font(.custom("Source Serif 4", size: 20).weight(.medium))
            Text("Tap record below. Transcription happens entirely on this device — no internet needed. Lock the screen and keep talking.")
                .font(.custom("Source Sans 3", size: 15))
                .foregroundStyle(Theme.textMuted(colorScheme))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 44)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var regularEmptyState: some View {
        VStack(spacing: 12) {
            if shouldShowRecorderStatus {
                recorderStatusBanner
                    .frame(maxWidth: 680)
                    .padding(.bottom, 12)
            }
            Image(systemName: "waveform")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(Theme.textMuted(colorScheme))
            Text("Talk to your iPad")
                .font(.custom("Source Serif 4", size: 24).weight(.medium))
            Text("Tap record below. Transcription happens entirely on this device — no internet needed. Lock the screen and keep talking.")
                .font(.custom("Source Sans 3", size: 16))
                .foregroundStyle(Theme.textMuted(colorScheme))
                .multilineTextAlignment(.center)
                .frame(maxWidth: 520)
        }
        .padding(.horizontal, 32)
        .padding(.bottom, 86)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var noSearchResults: some View {
        ContentUnavailableView.search(text: searchText)
            .padding(.bottom, 86)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var shouldShowRecorderStatus: Bool {
        model.recorder.pendingSessionCount > 0 || model.recorder.lastError != nil
    }

    private var recorderStatusBanner: some View {
        let pendingCount = model.recorder.pendingSessionCount
        let title = pendingCount == 1
            ? "1 recording waiting to transcribe"
            : "\(pendingCount) recordings waiting to transcribe"
        let message = model.recorder.lastError
            ?? "Audio is saved on this \(deviceName). Field Theory will retry when the app is open."

        return HStack(spacing: 12) {
            Image(systemName: pendingCount > 0 ? "clock.arrow.circlepath" : "exclamationmark.triangle")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(pendingCount > 0 ? Theme.link : Theme.unread)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(pendingCount > 0 ? title : "Voice needs attention")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.text(colorScheme))
                Text(message)
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.textMuted(colorScheme))
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            if pendingCount > 0 {
                Button {
                    Task { await model.recorder.resumePendingWork() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.link)
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Retry transcription")
            }
        }
        .padding(12)
        .background(Theme.backgroundAlt(colorScheme), in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Theme.border(colorScheme), lineWidth: 1)
        )
    }

    // MARK: Record bar

    private var recordBar: some View {
        let recorder = model.recorder
        let accent = Theme.accent(model.settings.accentPreset, colorScheme)

        return Button {
            recorder.toggle()
        } label: {
            Group {
                switch recorder.phase {
                case .idle:
                    HStack(spacing: 9) {
                        Image(systemName: "mic.fill")
                        Text("Record")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 26)
                    .frame(height: 52)
                    .background(accent, in: Capsule())
                case .recording:
                    HStack(spacing: 12) {
                        WaveformBars(level: recorder.level, tint: .white)
                        Text(recorder.elapsed.clockString)
                            .font(.system(size: 16, weight: .semibold, design: .monospaced))
                            .foregroundStyle(.white)
                        Image(systemName: "stop.fill")
                            .foregroundStyle(.white)
                    }
                    .padding(.horizontal, 24)
                    .frame(height: 52)
                    .background(Theme.unread, in: Capsule())
                case .transcribing:
                    HStack(spacing: 10) {
                        ProgressView().tint(.white)
                        Text("Transcribing…")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(.white)
                    }
                    .padding(.horizontal, 24)
                    .frame(height: 52)
                    .background(accent.opacity(0.85), in: Capsule())
                }
            }
            .shadow(color: .black.opacity(0.2), radius: 12, y: 4)
        }
        .buttonStyle(.plain)
        .animation(.spring(duration: 0.3), value: recorder.phase)
        .padding(.bottom, 12)
    }

    private var regularRecordBar: some View {
        let recorder = model.recorder

        return Button {
            recorder.toggle()
        } label: {
            regularRecordLabel
                .frame(width: 248, height: 52)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .hoverEffect(.lift)
        .keyboardShortcut("r", modifiers: [.command, .shift])
        .help(recorder.phase == .recording ? "Stop recording (Shift-Command-R)" : "Start recording (Shift-Command-R)")
        .accessibilityLabel(recorder.phase == .recording ? "Stop recording" : "Start recording")
        .animation(.spring(duration: 0.3), value: recorder.phase)
        .padding(8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.border(colorScheme), lineWidth: 0.5))
        .padding(.bottom, 16)
        .shadow(color: .black.opacity(0.16), radius: 12, y: 5)
    }

    @ViewBuilder
    private var regularRecordLabel: some View {
        let recorder = model.recorder
        let accent = Theme.accent(model.settings.accentPreset, colorScheme)

        switch recorder.phase {
        case .idle:
            HStack(spacing: 9) {
                Image(systemName: "mic.fill")
                Text("Record")
                    .font(.system(size: 16, weight: .semibold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(accent, in: Capsule())
        case .recording:
            HStack(spacing: 12) {
                WaveformBars(level: recorder.level, tint: .white)
                Text(recorder.elapsed.clockString)
                    .font(.system(size: 16, weight: .semibold, design: .monospaced))
                Image(systemName: "stop.fill")
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.unread, in: Capsule())
        case .transcribing:
            HStack(spacing: 10) {
                ProgressView().tint(.white)
                Text("Transcribing…")
                    .font(.system(size: 15, weight: .medium))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(accent.opacity(0.85), in: Capsule())
        }
    }

    // MARK: Selection bar — Back | Stack | Unstack | Edit | Delete

    private var selectionBar: some View {
        HStack(spacing: 0) {
            selectionAction("Back", systemImage: "chevron.left", enabled: true) {
                exitSelection()
            }
            selectionAction("Stack", systemImage: "square.stack.3d.up", enabled: selectedIds.count >= 2) {
                stackSelected()
            }
            selectionAction("Unstack", systemImage: "square.stack.3d.down.right", enabled: hasSelectedStack) {
                unstackSelected()
            }
            selectionAction("Edit", systemImage: "pencil", enabled: selectedIds.count == 1) {
                editSelected()
            }
            selectionAction("Delete", systemImage: "trash", enabled: !selectedIds.isEmpty, destructive: true) {
                deleteSelected()
            }
        }
        .frame(height: 56)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.border(colorScheme), lineWidth: 0.5))
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
        .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
    }

    private func selectionAction(_ label: String, systemImage: String, enabled: Bool, destructive: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: systemImage)
                    .font(.system(size: 16, weight: .medium))
                Text(label)
                    .font(.system(size: 10.5, weight: .medium))
            }
            .foregroundStyle(enabled ? (destructive ? Theme.unread : Theme.text(colorScheme)) : Theme.textMuted(colorScheme).opacity(0.45))
            .frame(maxWidth: .infinity)
        }
        .disabled(!enabled)
    }

    private var regularSelectionBar: some View {
        ViewThatFits(in: .horizontal) {
            regularSelectionActions(iconOnly: false)
                .fixedSize(horizontal: true, vertical: false)
            regularSelectionActions(iconOnly: true)
                .fixedSize(horizontal: true, vertical: false)
        }
        .padding(8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.border(colorScheme), lineWidth: 0.5))
        .padding(.horizontal, 24)
        .padding(.bottom, 16)
        .shadow(color: .black.opacity(0.16), radius: 12, y: 5)
    }

    private func regularSelectionActions(iconOnly: Bool) -> some View {
        let visibleIds = Set(items.map(\.id))
        let allVisibleSelected = !visibleIds.isEmpty && visibleIds.isSubset(of: selectedIds)

        return HStack(spacing: 2) {
            Text("\(selectedIds.count) selected")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.text(colorScheme))
                .contentTransition(.numericText())
                .frame(minWidth: 84, alignment: .leading)
                .padding(.horizontal, 8)

            Divider()
                .frame(height: 28)
                .padding(.horizontal, 4)

            regularSelectionAction(
                allVisibleSelected ? "Clear" : "Select All",
                systemImage: allVisibleSelected ? "checkmark.circle.badge.xmark" : "checkmark.circle",
                enabled: !items.isEmpty,
                iconOnly: iconOnly
            ) {
                if allVisibleSelected {
                    selectedIds.subtract(visibleIds)
                } else {
                    selectedIds.formUnion(visibleIds)
                }
            }
            .keyboardShortcut("a", modifiers: .command)

            regularSelectionAction("Stack", systemImage: "square.stack.3d.up", enabled: selectedIds.count >= 2, iconOnly: iconOnly) {
                stackSelected()
            }
            .keyboardShortcut("s", modifiers: [.command, .option])

            regularSelectionAction("Unstack", systemImage: "square.stack.3d.down.right", enabled: hasSelectedStack, iconOnly: iconOnly) {
                unstackSelected()
            }
            .keyboardShortcut("u", modifiers: [.command, .option])

            regularSelectionAction("Edit", systemImage: "pencil", enabled: selectedIds.count == 1, iconOnly: iconOnly) {
                editSelected()
            }
            .keyboardShortcut("e", modifiers: .command)

            regularSelectionAction("Delete", systemImage: "trash", enabled: !selectedIds.isEmpty, destructive: true, iconOnly: iconOnly) {
                deleteSelected()
            }
            .keyboardShortcut(.delete, modifiers: [])

            Divider()
                .frame(height: 28)
                .padding(.horizontal, 4)

            regularSelectionAction("Done", systemImage: "xmark", enabled: true, iconOnly: iconOnly) {
                exitSelection()
            }
            .keyboardShortcut(.escape, modifiers: [])
        }
    }

    private func regularSelectionAction(
        _ label: String,
        systemImage: String,
        enabled: Bool,
        destructive: Bool = false,
        iconOnly: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Group {
                if iconOnly {
                    Image(systemName: systemImage)
                        .frame(width: 36, height: 36)
                } else {
                    Label(label, systemImage: systemImage)
                        .font(.system(size: 13, weight: .medium))
                        .padding(.horizontal, 10)
                        .frame(height: 36)
                }
            }
            .foregroundStyle(enabled ? (destructive ? Theme.unread : Theme.text(colorScheme)) : Theme.textMuted(colorScheme).opacity(0.45))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .hoverEffect(.highlight)
        .help(label)
        .accessibilityLabel(label)
    }

    // MARK: Interactions

    private func handleTap(_ item: TranscriptItem) {
        if selectionMode {
            if selectedIds.contains(item.id) {
                selectedIds.remove(item.id)
                if selectedIds.isEmpty { exitSelection() }
            } else {
                selectedIds.insert(item.id)
            }
        } else {
            copy(item)
        }
    }

    private func copy(_ item: TranscriptItem) {
        UIPasteboard.general.string = item.text
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        copiedId = item.id
        copiedResetTask?.cancel()
        copiedResetTask = Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard !Task.isCancelled else { return }
            copiedId = nil
        }
    }

    private func enterSelection() {
        selectionMode = true
        selectedIds = []
    }

    private func enterSelection(with item: TranscriptItem) {
        guard !selectionMode else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        selectionMode = true
        selectedIds = [item.id]
    }

    private func exitSelection() {
        selectionMode = false
        selectedIds = []
    }

    private func stackSelected() {
        let ordered = items.filter { selectedIds.contains($0.id) }.map(\.id)
        guard ordered.count >= 2 else { return }
        Task { await model.transcripts.stack(ids: ordered) }
        exitSelection()
        toast.show("Stacked", symbol: "square.stack.3d.up.fill")
    }

    private func unstackSelected() {
        let stacks = selectedItems.filter(\.isStack)
        guard !stacks.isEmpty else { return }
        Task {
            for stack in stacks { await model.transcripts.unstack(stack) }
        }
        exitSelection()
        toast.show("Unstacked", symbol: "square.stack.3d.down.right")
    }

    private func editSelected() {
        guard let item = selectedItems.first, selectedIds.count == 1 else { return }
        editingItem = item
        exitSelection()
    }

    private func deleteSelected() {
        let ids = Array(selectedIds)
        guard !ids.isEmpty else { return }
        Task { await model.transcripts.delete(ids: ids) }
        exitSelection()
    }

    private func toggleExpanded(_ item: TranscriptItem) {
        if expandedIds.contains(item.id) {
            expandedIds.remove(item.id)
        } else {
            expandedIds.insert(item.id)
        }
    }
}

/// The voice item card, matching the old app's anatomy: time (or "Copied!"),
/// word count, stack badge (long-press to unstack), Expand/Collapse pinned
/// top-right, 3-line clamp with a last-words verification line.
struct StackCard: View {
    let item: TranscriptItem
    let expanded: Bool
    let copied: Bool
    let selected: Bool
    let selectionMode: Bool
    let wideLayout: Bool
    let onTap: () -> Void
    let onCopy: () -> Void
    let onEdit: () -> Void
    let onSelect: () -> Void
    let onToggleExpand: () -> Void
    let onUnstack: () -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme

    private var accent: Color { Theme.accent(model.settings.accentPreset, colorScheme) }

    private var needsExpansion: Bool {
        item.text.count > 160 || item.text.contains("\n")
    }

    private var wordCount: Int {
        item.text.split(whereSeparator: \.isWhitespace).count
    }

    /// Last three words, shown while collapsed so a glance confirms the
    /// whole capture made it.
    private var lastWords: String? {
        let words = item.text.split(whereSeparator: \.isWhitespace)
        guard !expanded, needsExpansion, words.count > 15 else { return nil }
        return words.suffix(3).joined(separator: " ")
    }

    private var timeLabel: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: item.createdAtMs.msToDate)
    }

    @ViewBuilder
    var body: some View {
        if wideLayout {
            cardContent
                .onTapGesture { onTap() }
                .contextMenu { regularContextMenu }
                .hoverEffect(.highlight)
                .help(selectionMode ? "Click to toggle selection" : "Click to copy; right-click for actions")
        } else {
            cardContent
                .onTapGesture { onTap() }
                // The old app's mechanic exactly: hold still ~600ms → selection mode.
                // No context menu here — it would swallow the long-press.
                .onLongPressGesture(minimumDuration: 0.6, maximumDistance: 8) { onSelect() }
        }
    }

    private var cardContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            Text(item.text)
                .font(.custom("Source Sans 3", size: 16))
                .foregroundStyle(Theme.text(colorScheme))
                .lineSpacing(3)
                .lineLimit(expanded ? nil : (wideLayout ? 5 : 3))
                .frame(maxWidth: .infinity, alignment: .leading)
            if let lastWords {
                Text("[…] \(lastWords)")
                    .font(.custom("Source Sans 3", size: 14).italic())
                    .foregroundStyle(Theme.textMuted(colorScheme))
            }
        }
        .padding(wideLayout ? 16 : 15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: wideLayout ? 164 : nil, alignment: .top)
        .background(
            RoundedRectangle(cornerRadius: 15)
                .fill(selected ? accent.opacity(0.08) : Theme.backgroundAlt(colorScheme))
                .overlay(
                    RoundedRectangle(cornerRadius: 15)
                        .strokeBorder(
                            copied ? Theme.link : (selected ? accent : Theme.border(colorScheme)),
                            lineWidth: copied || selected ? 1.5 : 1
                        )
                )
        )
        .overlay(alignment: .topLeading) {
            if selectionMode {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 21))
                    .foregroundStyle(selected ? accent : Color.secondary)
                    .background(Theme.background(colorScheme), in: Circle())
                    .offset(x: -7, y: -7)
            }
        }
        .contentShape(Rectangle())
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(selectionMode ? "Toggles selection" : "Copies transcript")
        .accessibilityAction(named: Text("Copy Transcript")) { onCopy() }
        .accessibilityAction(named: Text("Edit Transcript")) { onEdit() }
        .accessibilityAction(named: Text(selected ? "Deselect Transcript" : "Select Transcript")) {
            selectionMode ? onTap() : onSelect()
        }
    }

    @ViewBuilder
    private var regularContextMenu: some View {
        if selectionMode {
            Button {
                onTap()
            } label: {
                Label(selected ? "Deselect" : "Select", systemImage: selected ? "circle" : "checkmark.circle")
            }
        } else {
            Button {
                onCopy()
            } label: {
                Label("Copy", systemImage: "doc.on.doc")
            }
            Button {
                onEdit()
            } label: {
                Label("Edit", systemImage: "pencil")
            }
            Button {
                onSelect()
            } label: {
                Label("Select", systemImage: "checkmark.circle")
            }
            if needsExpansion {
                Button {
                    onToggleExpand()
                } label: {
                    Label(expanded ? "Collapse" : "Expand", systemImage: expanded ? "chevron.up" : "chevron.down")
                }
            }
            if item.isStack {
                Divider()
                Button {
                    onUnstack()
                } label: {
                    Label("Unstack", systemImage: "square.stack.3d.down.right")
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(copied ? "Copied!" : timeLabel)
                .font(.system(size: 12, weight: copied ? .semibold : .regular))
                .foregroundStyle(copied ? Theme.link : Theme.textMuted(colorScheme).opacity(0.8))

            Text("\(wordCount) words")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 2.5)
                .background(Theme.textMuted(colorScheme).opacity(0.12), in: RoundedRectangle(cornerRadius: 6))

            if item.isStack {
                HStack(spacing: 4) {
                    Image(systemName: "square.3.layers.3d")
                        .font(.system(size: 11, weight: .semibold))
                    Text("\(item.segments?.count ?? 0)")
                        .font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(accent)
                .padding(.horizontal, 7)
                .padding(.vertical, 2.5)
                .background(accent.opacity(0.13), in: RoundedRectangle(cornerRadius: 8))
                .onLongPressGesture(minimumDuration: 0.6) {
                    if !wideLayout && !selectionMode { onUnstack() }
                }
            }

            Spacer()

            if needsExpansion {
                Button {
                    onToggleExpand()
                } label: {
                    HStack(spacing: 3) {
                        Text(expanded ? "Collapse" : "Expand")
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 9, weight: .semibold))
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .help(expanded ? "Collapse transcript" : "Expand transcript")
            }
        }
    }
}

struct TranscriptEditSheet: View {
    let item: TranscriptItem
    var regularWidth = false
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @State private var text = ""
    @FocusState private var editorFocused: Bool

    var body: some View {
        NavigationStack {
            Group {
                if regularWidth {
                    regularEditor
                } else {
                    TextEditor(text: $text)
                        .font(.custom("Source Sans 3", size: 16))
                        .padding(.horizontal, 12)
                }
            }
                .navigationTitle(regularWidth ? "Edit Transcript" : "Edit")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                            .keyboardShortcut(.cancelAction)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            Task { await model.transcripts.update(item, text: text) }
                            dismiss()
                        }
                        .fontWeight(.semibold)
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .keyboardShortcut(.return, modifiers: .command)
                    }
                }
                .onAppear {
                    text = item.text
                    if regularWidth { editorFocused = true }
                }
        }
        .frame(idealWidth: regularWidth ? 680 : nil, idealHeight: regularWidth ? 640 : nil)
    }

    private var regularEditor: some View {
        VStack(spacing: 0) {
            HStack(spacing: 16) {
                Label(
                    item.createdAtMs.msToDate.formatted(date: .abbreviated, time: .shortened),
                    systemImage: "calendar"
                )
                Text("\(text.split(whereSeparator: \.isWhitespace).count) words")
                Spacer()
                Text("\(text.count) characters")
            }
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Theme.textMuted(colorScheme))
            .padding(.horizontal, 24)
            .frame(height: 44)
            .background(Theme.backgroundAlt(colorScheme))

            Divider()

            TextEditor(text: $text)
                .focused($editorFocused)
                .font(.custom("Source Sans 3", size: 17))
                .lineSpacing(4)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 20)
                .padding(.vertical, 14)
                .background(Theme.background(colorScheme))
        }
    }
}
