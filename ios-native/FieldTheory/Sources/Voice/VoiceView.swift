import SwiftUI

struct VoiceView: View {
    @Binding var showSettings: Bool
    @Environment(AppModel.self) private var model
    @Environment(ToastCenter.self) private var toast
    @Environment(\.colorScheme) private var colorScheme

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

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Group {
                    if model.transcripts.items.isEmpty {
                        emptyState
                    } else {
                        list
                    }
                }
                if selectionMode {
                    selectionBar
                } else {
                    recordBar
                }
            }
            .background(Theme.background(colorScheme))
            .navigationTitle("Voice")
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .automatic))
            .refreshable { await model.sync.syncNow() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .sheet(item: $editingItem) { item in
                TranscriptEditSheet(item: item)
            }
        }
    }

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 12, pinnedViews: []) {
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
                    StackCard(
                        item: item,
                        expanded: expandedIds.contains(item.id),
                        copied: copiedId == item.id,
                        selected: selectedIds.contains(item.id),
                        selectionMode: selectionMode,
                        onTap: { handleTap(item) },
                        onLongPress: { enterSelection(with: item) },
                        onToggleExpand: { toggleExpanded(item) },
                        onUnstack: {
                            Task { await model.transcripts.unstack(item) }
                            toast.show("Unstacked", symbol: "square.stack.3d.down.right")
                        }
                    )
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 150)
        }
        .scrollIndicators(.hidden)
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
            Image(systemName: "waveform")
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(Theme.textMuted(colorScheme))
            Text("Talk to your phone")
                .font(.custom("Source Serif 4", size: 20).weight(.medium))
            Text("Tap record below. Transcription happens entirely on this device — no internet needed. Lock the screen and keep talking.")
                .font(.custom("Source Sans 3", size: 15))
                .foregroundStyle(Theme.textMuted(colorScheme))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 44)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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

    // MARK: Selection bar — Back | Stack | Unstack | Edit | Delete

    private var selectionBar: some View {
        HStack(spacing: 0) {
            selectionAction("Back", systemImage: "chevron.left", enabled: true) {
                exitSelection()
            }
            selectionAction("Stack", systemImage: "square.stack.3d.up", enabled: selectedIds.count >= 2) {
                let ordered = items.filter { selectedIds.contains($0.id) }.map(\.id)
                Task { await model.transcripts.stack(ids: ordered) }
                exitSelection()
                toast.show("Stacked", symbol: "square.stack.3d.up.fill")
            }
            selectionAction("Unstack", systemImage: "square.stack.3d.down.right", enabled: hasSelectedStack) {
                let stacks = selectedItems.filter(\.isStack)
                Task {
                    for stack in stacks { await model.transcripts.unstack(stack) }
                }
                exitSelection()
                toast.show("Unstacked", symbol: "square.stack.3d.down.right")
            }
            selectionAction("Edit", systemImage: "pencil", enabled: selectedIds.count == 1) {
                editingItem = selectedItems.first
                exitSelection()
            }
            selectionAction("Delete", systemImage: "trash", enabled: !selectedIds.isEmpty, destructive: true) {
                Task { await model.transcripts.delete(ids: Array(selectedIds)) }
                exitSelection()
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
    let onTap: () -> Void
    let onLongPress: () -> Void
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

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            Text(item.text)
                .font(.custom("Source Sans 3", size: 16))
                .foregroundStyle(Theme.text(colorScheme))
                .lineSpacing(3)
                .lineLimit(expanded ? nil : 3)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let lastWords {
                Text("[…] \(lastWords)")
                    .font(.custom("Source Sans 3", size: 14).italic())
                    .foregroundStyle(Theme.textMuted(colorScheme))
            }
        }
        .padding(15)
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
        .onTapGesture { onTap() }
        .onLongPressGesture(minimumDuration: 0.6, maximumDistance: 8) { onLongPress() }
        .contextMenu {
            Button {
                UIPasteboard.general.string = item.text
            } label: {
                Label("Copy", systemImage: "doc.on.doc")
            }
            if item.isStack {
                Button { onUnstack() } label: {
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
                    if !selectionMode { onUnstack() }
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
            }
        }
    }
}

struct TranscriptEditSheet: View {
    let item: TranscriptItem
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    var body: some View {
        NavigationStack {
            TextEditor(text: $text)
                .font(.custom("Source Sans 3", size: 16))
                .padding(.horizontal, 12)
                .navigationTitle("Edit")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            Task { await model.transcripts.update(item, text: text) }
                            dismiss()
                        }
                        .fontWeight(.semibold)
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                .onAppear { text = item.text }
        }
    }
}
