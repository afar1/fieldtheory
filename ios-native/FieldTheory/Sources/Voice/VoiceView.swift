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

    private var items: [TranscriptItem] {
        guard !searchText.isEmpty else { return model.transcripts.items }
        return model.transcripts.items.filter { item in
            item.text.localizedCaseInsensitiveContains(searchText)
                || (item.segments ?? []).contains { $0.text.localizedCaseInsensitiveContains(searchText) }
        }
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
                recordBar
            }
            .background(Theme.background(colorScheme))
            .navigationTitle("Voice")
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .automatic))
            .refreshable { await model.sync.syncNow() }
            .toolbar { toolbarContent }
            .sheet(item: $editingItem) { item in
                TranscriptEditSheet(item: item)
            }
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        if selectionMode {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel") { exitSelection() }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                if selectedIds.count >= 2 {
                    Button {
                        let ordered = items.filter { selectedIds.contains($0.id) }.map(\.id)
                        Task { await model.transcripts.stack(ids: ordered) }
                        exitSelection()
                        toast.show("Stacked", symbol: "square.stack.3d.up.fill")
                    } label: {
                        Image(systemName: "square.stack.3d.up")
                    }
                }
                if selectedIds.count == 1,
                   let item = items.first(where: { selectedIds.contains($0.id) }) {
                    if item.isStack {
                        Button {
                            Task { await model.transcripts.unstack(item) }
                            exitSelection()
                        } label: {
                            Image(systemName: "square.stack.3d.down.right")
                        }
                    }
                    Button {
                        editingItem = item
                        exitSelection()
                    } label: {
                        Image(systemName: "pencil")
                    }
                }
                Button(role: .destructive) {
                    Task { await model.transcripts.delete(ids: Array(selectedIds)) }
                    exitSelection()
                } label: {
                    Image(systemName: "trash")
                }
                .disabled(selectedIds.isEmpty)
            }
        } else {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showSettings = true } label: {
                    Image(systemName: "gearshape")
                }
            }
        }
    }

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                if case .downloading(let progress) = model.recorder.models.state {
                    modelBanner(progress: progress)
                }
                ForEach(items) { item in
                    StackCard(
                        item: item,
                        expanded: expandedIds.contains(item.id),
                        selected: selectedIds.contains(item.id),
                        selectionMode: selectionMode,
                        onTap: { handleTap(item) },
                        onLongPress: { enterSelection(with: item) },
                        onToggleExpand: { toggleExpanded(item) }
                    )
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 150)
        }
        .scrollIndicators(.hidden)
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

    // MARK: Interactions

    private func handleTap(_ item: TranscriptItem) {
        if selectionMode {
            if selectedIds.contains(item.id) {
                selectedIds.remove(item.id)
                if selectedIds.isEmpty { selectionMode = false }
            } else {
                selectedIds.insert(item.id)
            }
        } else {
            UIPasteboard.general.string = item.text
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            toast.show("Copied", symbol: "doc.on.doc")
        }
    }

    private func enterSelection(with item: TranscriptItem) {
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

struct StackCard: View {
    let item: TranscriptItem
    let expanded: Bool
    let selected: Bool
    let selectionMode: Bool
    let onTap: () -> Void
    let onLongPress: () -> Void
    let onToggleExpand: () -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme

    private var needsExpansion: Bool { item.text.count > 280 }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                if selectionMode {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(selected ? Color.accentColor : Color.secondary)
                        .font(.system(size: 19))
                }
                Text(item.createdAtMs.msToDate.relativeShort)
                    .font(.system(size: 12))
                    .foregroundStyle(.tertiary)
                Spacer()
                if item.isStack {
                    Label("\(item.segments?.count ?? 0)", systemImage: "square.stack.3d.up.fill")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.accent(model.settings.accentPreset, colorScheme))
                }
            }

            Text(expanded || !needsExpansion ? item.text : String(item.text.prefix(280)) + "…")
                .font(.custom("Source Sans 3", size: 16))
                .foregroundStyle(Theme.text(colorScheme))
                .lineSpacing(3)
                .frame(maxWidth: .infinity, alignment: .leading)

            if needsExpansion {
                Button {
                    onToggleExpand()
                } label: {
                    Text(expanded ? "Show less" : "Show more")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.accent(model.settings.accentPreset, colorScheme))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(15)
        .background(
            RoundedRectangle(cornerRadius: 15)
                .fill(Theme.backgroundAlt(colorScheme))
                .overlay(
                    RoundedRectangle(cornerRadius: 15)
                        .strokeBorder(selected ? Color.accentColor : Theme.border(colorScheme), lineWidth: selected ? 1.5 : 1)
                )
        )
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
        .onLongPressGesture(minimumDuration: 0.5) { onLongPress() }
        .contextMenu {
            Button {
                UIPasteboard.general.string = item.text
            } label: {
                Label("Copy", systemImage: "doc.on.doc")
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
                    }
                }
                .onAppear { text = item.text }
        }
    }
}
