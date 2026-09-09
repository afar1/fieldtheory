import SwiftUI

private struct TranscriptDayGroup: Identifiable {
    let day: Date
    var items: [TranscriptItem]

    var id: Date { day }
}

private struct TranscriptSyncRequest {
    let item: TranscriptItem
    let workspace: UUID
    let sendToAgent: Bool
}

struct VoiceView: View {
    @Binding var showSettings: Bool
    @Environment(AppModel.self) private var model
    @Environment(ToastCenter.self) private var toast
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.scenePhase) private var scenePhase

    @State private var searchText = ""
    @State private var audioToDiscard: PendingAudioSession?
    @State private var selectionMode = false
    @State private var selectedIds: Set<String> = []
    @State private var editingItem: TranscriptItem?
    @State private var expandedIds: Set<String> = []
    @State private var copiedId: String?
    @State private var copiedResetTask: Task<Void, Never>?
    @State private var savingLocalChoice = false
    @State private var feedbackRequest: TranscriptSyncRequest?
    @State private var feedbackError: String?
    @State private var syncRequest: TranscriptSyncRequest?

    // Offer queued transcripts one at a time in the main control. Keep an
    // already-running deadline first so a new transcript cannot displace it.
    private var recordingPrivacyItem: TranscriptItem? {
        guard model.recorder.phase == .idle else { return nil }
        let offers = model.transcripts.pendingPrivacyOffers
        return offers.first(where: {
            if case .privacyHold = $0.syncState { return true }
            return false
        }) ?? offers.first
    }

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
        mainContent
            .confirmationDialog("Send feedback to support?", isPresented: Binding(
                get: { feedbackRequest != nil },
                set: { if !$0 { feedbackRequest = nil } }
            ), titleVisibility: .visible) {
                Button("Send feedback to support") {
                    guard let request = feedbackRequest else { return }
                    feedbackRequest = nil
                    submitFeedback(request)
                }
                Button("Cancel", role: .cancel) { feedbackRequest = nil }
            } message: {
                Text("Share this transcript with Field Theory support, along with your account ID, app version and device OS. No audio is included. It queues offline. Your agent choice stays the same.")
            }
            .alert("Feedback could not be queued", isPresented: Binding(
                get: { feedbackError != nil }, set: { if !$0 { feedbackError = nil } }
            )) { Button("OK") { feedbackError = nil } } message: { Text(feedbackError ?? "") }
    }

    private var mainContent: some View {
        NavigationStack {
            Group {
                if isRegularWidth {
                    regularContent
                } else {
                    compactContent
                }
            }
            .background(Theme.background(colorScheme))
            .navigationTitle("Ambition")
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .automatic))
            .refreshable { await model.sync.syncNow() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active, !showSettings {
                    beginVisiblePrivacyWindows()
                } else if phase != .active {
                    refreshVisiblePrivacyOffers()
                }
            }
            .onChange(of: showSettings) { _, isShowing in
                if isShowing {
                    refreshVisiblePrivacyOffers()
                } else if scenePhase == .active {
                    beginVisiblePrivacyWindows()
                }
            }
            .onChange(of: editingItem?.id) { _, id in
                if id != nil {
                    refreshVisiblePrivacyOffers()
                } else if scenePhase == .active, !showSettings {
                    beginVisiblePrivacyWindows()
                }
            }
            .onChange(of: model.storageAlert?.id) { _, id in
                if id != nil { refreshVisiblePrivacyOffers() }
                else { beginVisiblePrivacyWindows() }
            }
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
                    .accessibilityLabel("Settings")
                }
            }
            .alert("Discard this audio?", isPresented: Binding(
                get: { audioToDiscard != nil },
                set: { if !$0 { audioToDiscard = nil } }
            )) {
                Button("Keep audio", role: .cancel) { audioToDiscard = nil }
                Button("Discard audio", role: .destructive) {
                    if let session = audioToDiscard {
                        model.recorder.discardPendingSession(session)
                    }
                    audioToDiscard = nil
                }
            } message: {
                Text("Are you sure you want to discard the audio instead of retrying transcription? This cannot be undone.")
            }
            .confirmationDialog(syncRequest?.sendToAgent == true ? "Send this transcript to the agent?" : "Save this transcript to the cloud?", isPresented: Binding(
                get: { syncRequest != nil },
                set: { if !$0 { syncRequest = nil } }
            ), titleVisibility: .visible, presenting: syncRequest) { request in
                Button(request.sendToAgent ? "Send to agent" : "Save to cloud") { syncTranscript(request) }
                Button("Cancel", role: .cancel) {}
            } message: { request in
                Text(request.sendToAgent
                    ? "Allow the Mac Runner to send this transcript to your agent."
                    : "Save this transcript in Field Theory. Its action choice stays unchanged.")
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
            if selectionMode && recordingPrivacyItem == nil {
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

            if selectionMode && recordingPrivacyItem == nil {
                regularSelectionBar
            } else {
                regularRecordBar
            }
        }
    }

    private var compactList: some View {
        // Lazy rows can finish rendering after a stack shrinks the store.
        // Their indices and date headers must use the same immutable snapshot.
        let snapshot = items
        return ScrollView {
            LazyVStack(spacing: 12, pinnedViews: []) {
                modelStatus
                ForEach(Array(snapshot.enumerated()), id: \.element.id) { index, item in
                    if showsDateHeader(at: index, in: snapshot) {
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
                    modelStatus
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
        FeedbackSwipeCard(status: model.transcripts.feedbackState(for: item), enabled: !selectionMode, onFeedback: {
            feedbackRequest = TranscriptSyncRequest(item: item, workspace: model.workspaceGeneration, sendToAgent: false)
        }) {
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
            onRequestCloudSync: {
                syncRequest = TranscriptSyncRequest(item: item, workspace: model.workspaceGeneration, sendToAgent: true)
            },
            onRequestCloudSave: {
                syncRequest = TranscriptSyncRequest(item: item, workspace: model.workspaceGeneration, sendToAgent: false)
            },
            onOpenRemote: refreshVisiblePrivacyOffers,
            onToggleExpand: { toggleExpanded(item) },
            onUnstack: {
                unstackItems([item])
            }
        )
        }
        .accessibilityIdentifier("VoiceTranscript-\(item.id)")
        .onAppear {
            model.recorder.markTranscriptVisible(transcriptID: item.id)
        }
    }

    private func submitFeedback(_ request: TranscriptSyncRequest) {
        guard request.workspace == model.workspaceGeneration, !model.isSigningOut else { return }
        Task { @MainActor in
            guard request.workspace == model.workspaceGeneration, !model.isSigningOut else { return }
            do {
                try await model.sync.queueFeedback(item: request.item)
                guard request.workspace == model.workspaceGeneration else { return }
                toast.show("Feedback queued for support", symbol: "bubble.left")
            } catch {
                guard request.workspace == model.workspaceGeneration else { return }
                feedbackError = error.localizedDescription
            }
        }
    }

    private func showsDateHeader(at index: Int, in items: [TranscriptItem]) -> Bool {
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

    @ViewBuilder
    private var modelStatus: some View {
        switch model.recorder.engineState {
        case .ready:
            EmptyView()
        case .checking:
            engineProgressBanner(message: "Checking Parakeet…", progress: nil)
        case .downloading(let progress):
            VStack(alignment: .leading, spacing: 6) {
                engineProgressBanner(
                    message: "Downloading Parakeet \(Int(progress * 100))%",
                    progress: progress
                )
                Text("Download continues in the background. If you force-quit the app, reopen it and retry.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        case .preparing:
            engineProgressBanner(message: "Preparing Parakeet…", progress: nil)
        case .notDownloaded:
            engineBanner(
                title: "Parakeet needs downloading",
                message: "Open Settings to download Parakeet.",
                systemImage: "arrow.down.circle",
                tint: Theme.link,
                actionTitle: "Open Settings"
            )
        case .failed(let message):
            engineBanner(
                title: "Parakeet needs attention",
                message: message,
                systemImage: "exclamationmark.triangle",
                tint: Theme.unread,
                actionTitle: "Open Settings"
            )
        }
    }

    private func beginVisiblePrivacyWindows() {
        if let item = recordingPrivacyItem { beginPrivacyWindow(item.id) }
    }

    /// A privacy window begins only after its affordance appears while Voice is
    /// genuinely usable. The store records the absolute deadline atomically.
    private func beginPrivacyWindow(_ id: String) {
        guard scenePhase == .active, !showSettings, editingItem == nil,
              model.storageAlert == nil, recordingPrivacyItem?.id == id else { return }
        let store = model.transcripts
        let workspace = model.workspaceGeneration
        Task { @MainActor in
            guard workspace == model.workspaceGeneration,
                  !model.isSigningOut,
                  scenePhase == .active,
                  !showSettings,
                  editingItem == nil,
                  model.storageAlert == nil,
                  recordingPrivacyItem?.id == id
            else { return }
            _ = await store.beginPrivacyWindow(id: id)
        }
    }

    /// The explicit tap is available only during the visible, persisted
    /// deadline. A false write immediately reloads instead of claiming success.
    private func keepPrivacyOfferLocal(_ id: String) {
        guard case .privacyHold(let deadline)? = model.transcripts.items.first(where: { $0.id == id })?.syncState,
              deadline > Timestamps.nowMs()
        else { return }
        persistLocalPrivacyChoice(id)
    }

    private func persistLocalPrivacyChoice(_ id: String) {
        guard !savingLocalChoice else { return }
        savingLocalChoice = true
        let store = model.transcripts
        let workspace = model.workspaceGeneration
        Task { @MainActor in
            defer { savingLocalChoice = false }
            guard workspace == model.workspaceGeneration, !model.isSigningOut else { return }
            let kept = await store.keepLocal(id: id)
            if !kept, workspace == model.workspaceGeneration {
                await store.reload()
            }
        }
    }

    /// Already-started windows belong to the store and survive navigation.
    private func refreshVisiblePrivacyOffers() {
        beginVisiblePrivacyWindows()
    }

    /// A time is enough to distinguish simultaneous privacy choices without
    /// putting a transcript excerpt into the compact, time-bounded control.
    private func privacyOfferRecordHint(for item: TranscriptItem) -> String? {
        guard model.transcripts.pendingPrivacyOffers.count > 1 else { return nil }
        let time = DateFormatter.localizedString(
            from: item.createdAtMs.msToDate,
            dateStyle: .none,
            timeStyle: .short
        )
        return "Recording at \(time)"
    }

    private func engineProgressBanner(message: String, progress: Double?) -> some View {
        HStack(spacing: 10) {
            if let progress {
                ProgressView(value: progress).frame(maxWidth: .infinity)
            } else {
                ProgressView()
            }
            Text(message)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize()
        }
        .padding(12)
        .background(Theme.backgroundAlt(colorScheme), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityIdentifier("SpeechEngineStatus")
    }

    private func engineBanner(
        title: String,
        message: String,
        systemImage: String,
        tint: Color,
        actionTitle: String? = nil
    ) -> some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(tint)
                .font(.system(size: 17, weight: .semibold))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.text(colorScheme))
                Text(message)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textMuted(colorScheme))
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            if let actionTitle {
                Button(actionTitle) { showSettings = true }
                    .font(.system(size: 12, weight: .semibold))
            }
        }
        .padding(12)
        .background(Theme.backgroundAlt(colorScheme), in: RoundedRectangle(cornerRadius: 12))
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            modelStatus.padding(.horizontal, 16)
            Image(systemName: "waveform")
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(Theme.textMuted(colorScheme))
            Text("Talk to your \(deviceName)")
                .font(.custom("Source Serif 4", size: 20).weight(.medium))
            Text("Tap record below.")
                .font(.custom("Source Sans 3", size: 15))
                .foregroundStyle(Theme.textMuted(colorScheme))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 44)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var regularEmptyState: some View {
        VStack(spacing: 12) {
            modelStatus.frame(maxWidth: 680)
            Image(systemName: "waveform")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(Theme.textMuted(colorScheme))
            Text("Talk to your iPad")
                .font(.custom("Source Serif 4", size: 24).weight(.medium))
            Text("Tap record below.")
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

    // MARK: Record bar

    private var recordBar: some View {
        recordingControls.padding(.bottom, 12)
    }

    private var regularRecordBar: some View {
        recordingControls
            .padding(8)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
            .padding(.bottom, 16)
    }

    private var recordingControls: some View {
        let recorder = model.recorder
        let privacyItem = recordingPrivacyItem
        let pending = recorder.phase == .idle && privacyItem == nil ? recorder.nextPendingSession : nil
        return VStack(spacing: 8) {
            if recorder.phase == .idle, let error = recorder.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 20)
            }
            HStack(spacing: 10) {
                if let pending {
                    Button { audioToDiscard = pending } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 17, weight: .semibold))
                            .frame(width: 48, height: 52)
                            .background(.regularMaterial, in: Capsule())
                    }
                    .accessibilityLabel("Discard audio")
                    .accessibilityIdentifier("VoiceDiscardAudio")
                }
                Button {
                    if let privacyItem {
                        // A tap rendered for this choice can never start audio,
                        // including at the exact countdown expiry boundary.
                        keepPrivacyOfferLocal(privacyItem.id)
                    } else if pending != nil {
                        Task { await recorder.resumePendingWork() }
                    } else {
                        recorder.toggle()
                    }
                } label: {
                    Group {
                        if let privacyItem {
                            privacyControlLabel(for: privacyItem)
                        } else {
                            recordingControlLabel
                        }
                    }
                        .padding(.horizontal, 22)
                        .frame(height: 52)
                        .background(
                            privacyItem != nil ? Color(hex: 0xB45309)
                                : recorder.phase == .recording ? Theme.unread
                                : Theme.accent(model.settings.accentPreset, colorScheme),
                            in: Capsule()
                        )
                        .foregroundStyle(.white)
                }
                .disabled(recorder.phase == .transcribing || savingLocalChoice)
                .accessibilityValue(privacyItem?.id ?? "")
                .accessibilityIdentifier("VoiceRecordingControl")
                .keyboardShortcut("r", modifiers: [.command, .shift])
            }
            .buttonStyle(.plain)
            .shadow(color: .black.opacity(0.16), radius: 12, y: 4)
        }
        .animation(.spring(duration: 0.3), value: recorder.phase)
        .onAppear { beginVisiblePrivacyWindows() }
        .onChange(of: privacyItem?.id) { _, _ in beginVisiblePrivacyWindows() }
    }

    private func privacyControlLabel(for item: TranscriptItem) -> some View {
        TimelineView(.periodic(from: .now, by: 0.2)) { context in
            HStack(spacing: 10) {
                Image(systemName: "hand.raised.fill")
                VStack(spacing: 2) {
                    Text("No action")
                        .font(.system(size: 15, weight: .semibold))
                    if case .privacyHold(let deadline) = item.syncState {
                        let remaining = max(0, Int(ceil(deadline.msToDate.timeIntervalSince(context.date))))
                        Text("Send to agent in \(remaining)s")
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                    } else {
                        Text("Starting countdown…").font(.system(size: 12))
                    }
                    if let hint = privacyOfferRecordHint(for: item) {
                        Text(hint).font(.system(size: 10))
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var recordingControlLabel: some View {
        let recorder = model.recorder
        switch recorder.phase {
        case .idle:
            if recorder.nextPendingSession != nil {
                HStack(spacing: 9) {
                    Image(systemName: "arrow.clockwise")
                    VStack(spacing: 2) {
                        Text(recorder.lastError == nil ? "Audio saved" : "Transcription failed")
                            .font(.system(size: 14, weight: .semibold))
                        Text("Retry transcription?").font(.system(size: 12))
                    }
                }
            } else {
                Label("Record", systemImage: "mic.fill")
                    .font(.system(size: 16, weight: .semibold))
            }
        case .recording:
            HStack(spacing: 12) {
                WaveformBars(level: recorder.level, tint: .white)
                Text(recorder.elapsed.clockString)
                    .font(.system(size: 16, weight: .semibold, design: .monospaced))
                Image(systemName: "stop.fill")
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Stop recording")
        case .transcribing:
            HStack(spacing: 10) {
                ProgressView().tint(.white)
                Text("Transcribing…").font(.system(size: 15, weight: .medium))
            }
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
        let store = model.transcripts
        let workspace = model.workspaceGeneration
        Task {
            guard model.workspaceGeneration == workspace,
                  await store.stack(ids: ordered),
                  model.workspaceGeneration == workspace else { return }
            exitSelection()
            toast.show("Stacked", symbol: "square.stack.3d.up.fill")
        }
    }

    private func unstackSelected() {
        let stacks = selectedItems.filter(\.isStack)
        guard !stacks.isEmpty else { return }
        unstackItems(stacks)
    }

    private func unstackItems(_ stacks: [TranscriptItem]) {
        let store = model.transcripts
        let workspace = model.workspaceGeneration
        Task {
            for stack in stacks {
                guard model.workspaceGeneration == workspace,
                      await store.unstack(stack) else { return }
            }
            guard model.workspaceGeneration == workspace else { return }
            exitSelection()
            toast.show("Unstacked", symbol: "square.stack.3d.down.right")
        }
    }

    private func editSelected() {
        guard let item = selectedItems.first, selectedIds.count == 1 else { return }
        editingItem = item
        exitSelection()
    }

    private func syncTranscript(_ request: TranscriptSyncRequest) {
        guard request.workspace == model.workspaceGeneration, !model.isSigningOut else { return }
        let store = model.transcripts
        Task {
            guard request.workspace == model.workspaceGeneration, !model.isSigningOut else { return }
            let queued: Bool
            if request.sendToAgent {
                queued = await store.requestCloudSync(id: request.item.id)
            } else {
                queued = await store.requestCloudSave(id: request.item.id)
            }
            guard request.workspace == model.workspaceGeneration else { return }
            if queued { toast.show(request.sendToAgent ? "Waiting for agent" : "Queued for cloud storage", symbol: "icloud.and.arrow.up") }
        }
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
/// word count, action tag, cloud/Remote icons and a bottom-right expansion
/// chevron, with a 3-line clamp and last-words verification line.
struct StackCard: View {
    @State private var showingDelivery = false
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
    let onRequestCloudSync: () -> Void
    let onRequestCloudSave: () -> Void
    let onOpenRemote: () -> Void
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
            if needsExpansion {
                HStack(alignment: .bottom, spacing: 8) {
                    if let lastWords {
                        Text("[…] \(lastWords)")
                            .font(.custom("Source Sans 3", size: 14).italic())
                            .foregroundStyle(Theme.textMuted(colorScheme))
                    }
                    Spacer(minLength: 0)
                    expansionButton.fixedSize()
                }
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

    private var hasEarlierSyncedRevision: Bool {
        (item.acknowledgedUpdatedAtMs ?? 0) > 0
            && item.acknowledgedUpdatedAtMs != item.updatedAtMs
    }

    private var actionLabel: String {
        VoiceDelivery.status(item: item, events: model.transcripts.events(for: item), receipt: model.transcripts.receipt(for: item))
    }

    private var syncStateBadge: some View {
        Button { showingDelivery = true } label: {
            Text(actionLabel)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(item.wasSentToAgent ? Theme.link : Theme.markRead)
                .padding(.horizontal, 6)
                .padding(.vertical, 2.5)
                .background((item.wasSentToAgent ? Theme.link : Theme.markRead).opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.borderless)
        .sheet(isPresented: $showingDelivery) {
            VoiceDeliveryView(item: item, onSend: onRequestCloudSync)
        }
        .fixedSize()
        .accessibilityLabel(actionLabel)
        .accessibilityValue(item.actionPolicy)
        .accessibilityHint("Shows delivery timestamps and Mac observations")
    }

    private var cloudStatusButton: some View {
        Button(action: onRequestCloudSave) {
            Image(systemName: item.isCloudSaved ? "checkmark.icloud" : "icloud.and.arrow.up")
                .symbolRenderingMode(.palette)
                .foregroundStyle(item.isCloudSaved ? Theme.link : Theme.textMuted(colorScheme), Theme.textMuted(colorScheme))
                .font(.system(size: 12))
        }
        .buttonStyle(.borderless)
        .disabled(item.isCloudSaved)
        .accessibilityLabel(item.isCloudSaved ? "Saved to cloud" : "Waiting to save to cloud")
        .accessibilityHint(item.isCloudSaved ? "Current version saved in Field Theory" : "Retry cloud storage without changing the action choice")
    }

    private var expansionButton: some View {
        Button(action: onToggleExpand) {
            // Retain the previous text-plus-chevron hit area, even though only
            // the chevron is visible. Reserve the wider Collapse label in both states.
            HStack(spacing: 3) {
                Text("Collapse").font(.system(size: 13))
                Image(systemName: "chevron.up").font(.system(size: 9, weight: .semibold))
            }
            .hidden()
            .overlay(alignment: .trailing) {
                Image(systemName: expanded ? "chevron.up" : "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(expanded ? "Collapse transcript" : "Expand transcript")
        .help(expanded ? "Collapse transcript" : "Expand transcript")
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

            syncStateBadge

            Spacer()

            HStack(spacing: 8) {
                cloudStatusButton
                if !selectionMode {
                    ChatGPTRemoteButton(onWillOpen: onOpenRemote)
                    .labelStyle(.iconOnly)
                        .buttonStyle(.plain)
                }
            }
            .fixedSize()
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
    @State private var segments: [TranscriptSegment] = []
    @State private var saving = false
    @State private var saveError: String?
    @FocusState private var editorFocused: Bool

    private var editsStackSegments: Bool { item.isStack }

    private var mergedStackText: String {
        segments.map(\.text).joined(separator: "\n\n")
    }

    private var canSave: Bool {
        if editsStackSegments {
            return !segments.isEmpty
                && segments.allSatisfy { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        }
        return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Group {
                if editsStackSegments {
                    stackSegmentEditor
                } else if regularWidth {
                    regularEditor
                } else {
                    TextEditor(text: $text)
                        .font(.custom("Source Sans 3", size: 16))
                        .padding(.horizontal, 12)
                }
            }
                .navigationTitle(editsStackSegments ? "Edit Stack" : (regularWidth ? "Edit Transcript" : "Edit"))
                .navigationBarTitleDisplayMode(.inline)
                .interactiveDismissDisabled(saving)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                            .keyboardShortcut(.cancelAction)
                            .disabled(saving)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        if saving {
                            ProgressView()
                        } else {
                            Button("Save") { save() }
                                .fontWeight(.semibold)
                                .disabled(!canSave)
                                .keyboardShortcut(.return, modifiers: .command)
                        }
                    }
                }
                .onAppear {
                    text = item.text
                    segments = item.segments ?? []
                    if regularWidth && !editsStackSegments { editorFocused = true }
                }
                .alert("Couldn’t save changes", isPresented: Binding(
                    get: { saveError != nil },
                    set: { if !$0 { saveError = nil } }
                )) {
                    Button("OK") { saveError = nil }
                } message: {
                    Text(saveError ?? "Try again.")
                }
        }
        .frame(idealWidth: regularWidth ? 680 : nil, idealHeight: regularWidth ? 640 : nil)
    }

    private var stackSegmentEditor: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Edit each original transcript separately. Their order and boundaries stay intact when you save.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                ForEach(segments.indices, id: \.self) { index in
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Segment \(index + 1)")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textMuted(colorScheme))
                        TextEditor(text: segmentTextBinding(at: index))
                            .font(.custom("Source Sans 3", size: 16))
                            .frame(minHeight: regularWidth ? 140 : 120)
                            .padding(8)
                            .background(Theme.backgroundAlt(colorScheme), in: RoundedRectangle(cornerRadius: 10))
                            .accessibilityIdentifier("VoiceStackSegment-\(index + 1)")
                    }
                }

                Divider()

                VStack(alignment: .leading, spacing: 4) {
                    Text("Merged transcript preview")
                        .font(.system(size: 13, weight: .semibold))
                    Text(mergedStackText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
            .padding(regularWidth ? 24 : 16)
        }
        .background(Theme.background(colorScheme))
    }

    private func segmentTextBinding(at index: Int) -> Binding<String> {
        Binding(
            get: { segments[index].text },
            set: { segments[index].text = $0 }
        )
    }

    private func save() {
        guard canSave, !saving else { return }
        saving = true
        saveError = nil
        let store = model.transcripts
        let workspace = model.workspaceGeneration
        let accountID = model.auth.userId
        let textSnapshot = text
        let segmentSnapshot = segments
        Task {
            let saved: Bool
            if editsStackSegments {
                saved = await store.updateSegments(item, segments: segmentSnapshot)
            } else {
                saved = await store.update(item, text: textSnapshot)
            }
            guard model.workspaceGeneration == workspace,
                  model.auth.userId == accountID else { return }
            saving = false
            if saved {
                dismiss()
            } else {
                saveError = "Your edits are still open. Check storage and try again."
            }
        }
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
