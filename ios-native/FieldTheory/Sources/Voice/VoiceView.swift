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

private struct VoiceToastStatus: Equatable {
    let message: String
    let symbol: String
}

struct VoiceView: View {
    @Binding var showSettings: Bool
    @Environment(AppModel.self) private var model
    @Environment(ToastCenter.self) private var toast
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var completedTranscriptID: String?
    @State private var sessionBeforeTranscription: String?
    @State private var presentingSessionID: String?
    @State private var presentationStartedAt: ContinuousClock.Instant?
    @State private var presentationTask: Task<Void, Never>?
    @State private var searchText = ""
    @State private var isSearchPresented = false
    @State private var recordingToDiscard: String?
    @State private var audioToDiscard: PendingAudioSession?
    @State private var pendingAudioDetails: String?
    @State private var selectionMode = false
    @State private var selectedIds: Set<String> = []
    @State private var editingItem: TranscriptItem?
    @State private var expandedIds: Set<String> = []
    @State private var copiedId: String?
    @State private var copiedResetTask: Task<Void, Never>?
    @State private var feedbackRequest: TranscriptSyncRequest?
    @State private var feedbackError: String?
    @State private var syncRequest: TranscriptSyncRequest?

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

    private var pendingCardID: String? {
        guard searchText.isEmpty, !selectionMode,
              let id = presentingSessionID ?? model.recorder.transcribingSessionID ?? model.recorder.nextPendingSession?.id,
              id != model.recorder.lastSavedSessionID || presentingSessionID == id else { return nil }
        return id
    }

    private var visibleItems: [TranscriptItem] {
        guard presentingSessionID == model.recorder.lastSavedSessionID,
              let savedID = model.recorder.lastSavedTranscriptID else { return items }
        return items.filter { $0.id != savedID }
    }

    private var cardMotion: Animation? {
        reduceMotion ? nil : .spring(response: 0.45, dampingFraction: 0.88)
    }

    private var deviceName: String {
        UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "phone"
    }

    private var dayGroups: [TranscriptDayGroup] {
        let calendar = Calendar.current
        return visibleItems.reduce(into: []) { groups, item in
            let day = calendar.startOfDay(for: item.createdAtMs.msToDate)
            if groups.last?.day == day {
                groups[groups.count - 1].items.append(item)
            } else {
                groups.append(TranscriptDayGroup(day: day, items: [item]))
            }
        }
    }

    var body: some View {
        let measurement = RecordingStartupDiagnostics.startMeasurement(.voiceBody)
        defer { measurement?.finish() }
        let observedContent = mainContent
            .onAppear {
                RecordingStartupDiagnostics.configureIfEnabled()
                updateCapturePreparationVisibility()
            }
            .onDisappear {
                presentationTask?.cancel()
                presentingSessionID = nil
                presentationStartedAt = nil
                model.recorder.setCapturePreparationVisible(false)
                toast.setStatus(nil)
            }
            .onChange(of: scenePhase) { _, _ in updateCapturePreparationVisibility() }
            .onChange(of: showSettings) { _, _ in updateCapturePreparationVisibility() }
            .onChange(of: voiceToastStatus, initial: true) { _, status in
                toast.setStatus(status?.message, symbol: status?.symbol)
            }
            .onChange(of: model.recorder.isStartingRecording) { _, starting in
                RecordingStartupDiagnostics.mark(starting ? "ui.pending-observed" : "ui.pending-ended")
            }
            .onChange(of: model.recorder.isStoppingRecording) { _, stopping in
                if stopping, let id = model.recorder.activeRecordingID {
                    presentationTask?.cancel()
                    presentingSessionID = id
                    presentationStartedAt = .now
                }
            }
            .onChange(of: model.recorder.lastSavedSessionID) { _, savedID in
                guard let savedID, savedID == presentingSessionID else { return }
                presentationTask?.cancel()
                let elapsed = presentationStartedAt.map { $0.duration(to: .now) } ?? .zero
                let remaining = max(.zero, .milliseconds(350) - elapsed)
                presentationTask = Task { @MainActor in
                    try? await Task.sleep(for: remaining)
                    guard !Task.isCancelled, presentingSessionID == savedID else { return }
                    presentingSessionID = nil
                    presentationStartedAt = nil
                }
            }
            .onChange(of: model.recorder.phase) { old, new in
                RecordingStartupDiagnostics.mark(new == .recording ? "ui.recording-observed" : "ui.nonrecording-observed")
                if new == .recording { completedTranscriptID = nil }
                if new == .transcribing {
                    completedTranscriptID = nil
                    sessionBeforeTranscription = model.recorder.lastTranscribedSessionID
                }
                if old == .transcribing, new == .idle,
                   model.recorder.nextPendingSession == nil,
                   model.recorder.lastTranscribedSessionID != nil,
                   model.recorder.lastTranscribedSessionID != sessionBeforeTranscription {
                    let savedID = model.recorder.lastSavedTranscriptID
                    if savedID != completedTranscriptID {
                        completedTranscriptID = savedID
                        toast.show("Transcribed", symbol: "checkmark")
                    }
                }
            }
            .onChange(of: model.workspaceGeneration) { _, _ in completedTranscriptID = nil }
        return observedContent
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
            .alert("Saved recording", isPresented: Binding(
                get: { pendingAudioDetails != nil }, set: { if !$0 { pendingAudioDetails = nil } }
            )) { Button("OK") { pendingAudioDetails = nil } } message: {
                Text(pendingAudioDetails ?? "")
            }
    }

    private func updateCapturePreparationVisibility() {
        model.recorder.setCapturePreparationVisible(scenePhase == .active && !showSettings)
    }

    private var mainContent: some View {
        let measurement = RecordingStartupDiagnostics.startMeasurement(.mainContent)
        defer { measurement?.finish() }
        return NavigationStack {
            Group {
                if isRegularWidth {
                    regularContent
                } else {
                    compactContent
                }
            }
            .background(Theme.background(colorScheme))
            .navigationTitle("Field Theory")
            .searchable(text: $searchText, isPresented: $isSearchPresented, placement: .navigationBarDrawer(displayMode: .automatic))
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
                    .accessibilityLabel("Settings")
                }
            }
            .alert("Are you sure you want to discard this audio?", isPresented: Binding(
                get: { recordingToDiscard != nil }, set: { if !$0 { recordingToDiscard = nil } }
            )) {
                Button("Keep recording", role: .cancel) { recordingToDiscard = nil }
                Button("Discard audio", role: .destructive) {
                    if let id = recordingToDiscard { Task { await model.recorder.discardActiveRecording(expectedID: id) } }
                    recordingToDiscard = nil
                }
            } message: { Text("This cannot be undone.") }
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
                if model.transcripts.items.isEmpty && pendingCardID == nil {
                    VStack { dateHeading("", showAutoSend: true).padding(.horizontal, 16); emptyState }
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
                if model.transcripts.items.isEmpty && pendingCardID == nil {
                    VStack { dateHeading("", showAutoSend: true).padding(.horizontal, 24); regularEmptyState }
                } else if items.isEmpty && pendingCardID == nil {
                    VStack { dateHeading("", showAutoSend: true).padding(.horizontal, 24); noSearchResults }
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

    private var autoSendControl: some View {
        Button {
            model.settings.autoSendTranscriptions.toggle()
            model.recorder.setCurrentTranscriptionAutoSend(model.settings.autoSendTranscriptions)
            model.recorder.capturePolicyDidChange()
        } label: {
            HStack(spacing: 6) {
                ZStack {
                    Circle().strokeBorder(lineWidth: 1).frame(width: 13, height: 13)
                    if model.settings.autoSendTranscriptions {
                        Image(systemName: "checkmark").font(.system(size: 8, weight: .semibold))
                    }
                }
                Text("Auto-send").font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(Theme.text(colorScheme))
            .frame(minHeight: 44, alignment: .trailing)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("AutoSendTranscriptions")
        .accessibilityLabel("Auto send transcriptions")
        .accessibilityValue(model.settings.autoSendTranscriptions ? "On" : "Off")
        .accessibilityHint("Applies to the current recording or transcription and new recordings. Cloud saving stays on.")
    }

    private func dateHeading(_ title: String, showAutoSend: Bool) -> some View {
        HStack {
            Text(title).font(.system(size: 11, weight: .semibold))
                .tracking(0.9)
                .textCase(.uppercase)
                .foregroundStyle(Theme.textMuted(colorScheme).opacity(0.78))
            Spacer()
            if showAutoSend { autoSendControl }
        }
    }

    private var compactList: some View {
        // Lazy rows can finish rendering after a stack shrinks the store.
        // Their indices and date headers must use the same immutable snapshot.
        let snapshot = visibleItems
        return ScrollView {
            LazyVStack(spacing: 14, pinnedViews: []) {
                if let pendingCardID {
                    dateHeading("Today", showAutoSend: true)
                    transcribingCard(id: pendingCardID)
                } else if snapshot.isEmpty {
                    dateHeading("", showAutoSend: true)
                }
                ForEach(RecordingStartupDiagnostics.measure(.listEnumeration) { Array(snapshot.enumerated()) }, id: \.element.id) { index, item in
                    if showsDateHeader(at: index, in: snapshot),
                       !(index == 0 && pendingCardID != nil && Calendar.current.isDateInToday(item.createdAtMs.msToDate)) {
                        dateHeading(Self.dateHeader(for: item.createdAtMs), showAutoSend: index == 0 && pendingCardID == nil)
                            .padding(.top, index == 0 ? 0 : 10)
                    }
                    transcriptCard(item, wideLayout: false)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 150)
            .animation(cardMotion, value: pendingCardID)
        }
        .scrollIndicators(.hidden)
    }

    private var regularGrid: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                if let pendingCardID {
                    VStack(alignment: .leading, spacing: 10) {
                        dateHeading("Today", showAutoSend: true)
                        transcribingCard(id: pendingCardID)
                            .frame(maxWidth: 460)
                    }
                }
                ForEach(dayGroups) { group in
                    VStack(alignment: .leading, spacing: 10) {
                        if !(pendingCardID != nil && Calendar.current.isDateInToday(group.day)) {
                            dateHeading(Self.dateHeader(for: group.items[0].createdAtMs), showAutoSend: group.id == dayGroups.first?.id && pendingCardID == nil)
                        }

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
            .animation(cardMotion, value: pendingCardID)
        }
        .scrollIndicators(.visible)
    }

    private func transcribingCard(id: String) -> some View {
        let label: String
        if model.recorder.phase == .transcribing {
            label = "Transcribing…"
        } else if case .failed = model.recorder.engineState {
            label = "Waiting to transcribe"
        } else if case .notDownloaded = model.recorder.engineState {
            label = "Waiting to transcribe"
        } else {
            label = "Preparing transcription…"
        }
        return TranscribingVoiceCard(accent: Theme.accent(model.settings.accentPreset, colorScheme),
                             textColor: Theme.text(colorScheme), reduceMotion: reduceMotion,
                             label: label)
        .accessibilityIdentifier("VoiceTranscribingCard-\(id)")
        .onTapGesture {
            if let pending = model.recorder.nextPendingSession, pending.id == id {
                showPendingAudioDetails(for: pending)
            }
        }
        .accessibilityHint("Shows recording details")
        .transition(reduceMotion ? .identity : .opacity.combined(with: .move(edge: .top)))
    }

    private func showPendingAudioDetails(for pending: PendingAudioSession) {
        let recorder = model.recorder
        pendingAudioDetails = [
            recorder.pendingError(for: pending) ?? recorder.lastError ?? "Transcription has not finished yet.",
            "The audio is saved on this phone. You can make another recording or tap Retry."
        ].joined(separator: "\n\n")
    }

    private var regularGridColumns: [GridItem] {
        [GridItem(.adaptive(minimum: 340, maximum: 460), spacing: 16, alignment: .top)]
    }

    private func transcriptCard(_ item: TranscriptItem, wideLayout: Bool) -> some View {
        let measurement = RecordingStartupDiagnostics.startMeasurement(.transcriptCard)
        defer { measurement?.finish() }
        return FeedbackSwipeCard(status: model.transcripts.feedbackState(for: item), enabled: !selectionMode, onFeedback: {
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
            onOpenRemote: {},
            onToggleExpand: { toggleExpanded(item) },
            onUnstack: {
                unstackItems([item])
            }
        )
        }
        .overlay(alignment: .topLeading) {
            if selectionMode {
                Image(systemName: selectedIds.contains(item.id) ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 21))
                    .foregroundStyle(selectedIds.contains(item.id) ? Theme.accent(model.settings.accentPreset, colorScheme) : Color.secondary)
                    .background(Theme.background(colorScheme), in: Circle())
                    .onTapGesture { handleTap(item) }
                    .accessibilityLabel(selectedIds.contains(item.id) ? "Deselect transcript" : "Select transcript")
                    .offset(x: -7, y: -7)
            }
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
        return dayFormatter.string(from: date)
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE, MMM d"
        return formatter
    }()

    private var emptyState: some View {
        VStack(spacing: 10) {
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
        VStack(spacing: 10) {
            queuedAudioControls
            recordingControls
        }
        .padding(.bottom, 12)
    }

    private var regularRecordBar: some View {
        VStack(spacing: 10) {
            queuedAudioControls
            recordingControls
        }
            .padding(8)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
            .padding(.bottom, 16)
    }

    @ViewBuilder
    private var queuedAudioControls: some View {
        let recorder = model.recorder
        if recorder.phase == .idle, let pending = recorder.nextPendingSession {
            HStack(spacing: 8) {
                Image(systemName: "waveform")
                    .foregroundStyle(Theme.textMuted(colorScheme))
                Text(recorder.pendingSessionCount == 1
                     ? "1 recording saved for transcription"
                     : "\(recorder.pendingSessionCount) recordings saved for transcription")
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(2)
                Spacer(minLength: 0)
                Button("Retry") { Task { await recorder.transcribeUserInitiated() } }
                    .font(.system(size: 12, weight: .semibold))
                    .accessibilityIdentifier("VoiceRetryTranscription")
                Button("Details") {
                    showPendingAudioDetails(for: pending)
                }
                .font(.system(size: 12, weight: .semibold))
                .accessibilityIdentifier("VoicePendingAudioDetails")
                Button {
                    if model.settings.confirmBeforeDiscarding { audioToDiscard = pending }
                    else { recorder.discardPendingSession(pending) }
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .frame(width: 32, height: 32)
                }
                .accessibilityLabel("Discard saved audio")
                .accessibilityIdentifier("VoiceDiscardAudio")
            }
            .foregroundStyle(Theme.text(colorScheme))
            .padding(.leading, 14)
            .padding(.trailing, 6)
            .frame(maxWidth: 480, minHeight: 44)
            .background(voiceControlSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(voiceControlOutline, lineWidth: 0.75))
            .padding(.horizontal, 16)
        }
    }

    private var recordingControls: some View {
        let recorder = model.recorder
        return ZStack(alignment: .leading) {
            Button {
                guard !recordingActionUnavailable else { return }
                RecordingStartupDiagnostics.setTranscriptCount(model.transcripts.items.count)
                recorder.toggle()
            } label: {
                recordingControlLabel
                    .clipShape(RoundedRectangle(cornerRadius: 32))
                    .contentShape(RoundedRectangle(cornerRadius: 32))
                    .modifier(RecordingStartupGeometryObservation())
                    .accessibilityElement(children: .ignore)
            }
            .buttonStyle(VoiceStatusButtonStyle(
                restingColor: controlBackground,
                acknowledgeRecordTap: recorder.phase == .idle,
                recording: recorder.phase == .recording,
                startFailed: recorder.lastError != nil
            ))
            .disabled(recordingActionUnavailable)
            .opacity(recordingActionUnavailable && !recorder.isStartingRecording ? 0.5 : 1)
            .accessibilityLabel(recordingControlAccessibilityLabel)
            .accessibilityHint("")
            .accessibilityIdentifier("VoiceRecordingControl")
            .keyboardShortcut("r", modifiers: [.command, .shift])
            // Accessory buttons never participate in the pill's centered layout.
            if recorder.phase == .recording && !recorder.isStoppingRecording {
                cancelRecordingButton
                    .offset(x: -54)
                    .modifier(RecordingDismissFadeIn())
            }
        }
        .shadow(color: .black.opacity(0.16), radius: 12, y: 4)
        .frame(maxWidth: 480)
        .padding(.horizontal, 16)
    }

    private var cancelRecordingButton: some View {
        Button {
            guard model.recorder.phase == .recording,
                  let id = model.recorder.activeRecordingID else { return }
            if model.settings.confirmBeforeDiscarding { recordingToDiscard = id }
            else { Task { await model.recorder.discardActiveRecording(expectedID: id) } }
        } label: {
            Image(systemName: "xmark").font(.body.weight(.semibold))
                .foregroundStyle(Theme.text(colorScheme))
                .frame(width: 44, height: 44)
                .background(voiceControlSurface, in: Circle())
                .overlay(Circle().strokeBorder(voiceControlOutline, lineWidth: 1))
                .shadow(color: .black.opacity(0.15), radius: 3, y: 2)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Cancel recording")
        .accessibilityIdentifier("VoiceCancelRecording")
    }

    private var recordingActionUnavailable: Bool {
        let recorder = model.recorder
        return recorder.phase == .transcribing || recorder.isStoppingRecording
            || (recorder.phase == .idle && !recorder.canStartRecording)
    }

    private var voiceControlSurface: Color {
        colorScheme == .dark ? Color(red: 0.16, green: 0.20, blue: 0.20) : .white
    }

    private var voiceControlOutline: Color {
        colorScheme == .dark ? Color(red: 0.39, green: 0.47, blue: 0.46)
            : Color(red: 0.71, green: 0.76, blue: 0.75)
    }

    private var voiceToastStatus: VoiceToastStatus? {
        let recorder = model.recorder
        if recorder.phase == .recording {
            return recorder.isStoppingRecording
                ? VoiceToastStatus(message: "Stopping recording…", symbol: "waveform") : nil
        }
        if recorder.isStartingRecording { return nil }
        if recorder.phase == .transcribing { return nil }
        if recorder.nextPendingSession != nil {
            return nil
        }
        if let error = recorder.lastError {
            return VoiceToastStatus(message: error, symbol: "exclamationmark.triangle")
        }
        switch recorder.engineState {
        case .checking: return VoiceToastStatus(message: "Preparing voice model…", symbol: "waveform")
        case .preparing: return VoiceToastStatus(message: recorder.preparationMessage, symbol: "waveform")
        case .downloading(let fraction):
            return VoiceToastStatus(message: "Downloading voice model · \(Int(fraction * 100))%", symbol: "arrow.down.circle")
        case .notDownloaded: return VoiceToastStatus(message: "Voice model needed — open Settings", symbol: "arrow.down.circle")
        case .failed(let error): return VoiceToastStatus(message: error, symbol: "exclamationmark.triangle")
        case .ready: return nil
        }
    }

    private var controlBackground: Color {
        if recordingControlsDesignPreview { return previewControlBackground }
        return model.recorder.isStartingRecording || model.recorder.phase == .recording
            ? Theme.unread : Theme.accent(model.settings.accentPreset, colorScheme)
    }

    /// Simulator-only rendering study; it does not change recorder state.
    private var recordingControlsDesignPreview: Bool {
        #if targetEnvironment(simulator)
        ProcessInfo.processInfo.arguments.contains("ft-recording-controls-design-preview")
        #else
        false
        #endif
    }

    private var previewControlBackground: Color {
        let recorder = model.recorder
        if recorder.isStartingRecording || recorder.phase == .recording || recorder.isStoppingRecording {
            return Color(hex: 0x933D34)
        }
        if recorder.phase == .transcribing { return Color(hex: 0x42647A) }
        if recorder.lastError != nil { return Color(hex: 0xA14A40) }
        return Color(hex: 0x3E5D3B)
    }

    private var recordingActionTitle: String {
        return "Record"
    }

    private var recordingActionIcon: String {
        return "mic.fill"
    }

    private var recordingControlAccessibilityLabel: String {
        model.recorder.phase == .recording ? "Stop recording" : recordingActionTitle
    }

    private var recordingControlLabel: some View {
        compactRecordingControlLabel
            .foregroundStyle(.white)
            .frame(width: 168, height: 52)
    }

    private var compactRecordingControlLabel: some View {
        let recording = model.recorder.phase == .recording
        return ZStack {
            if recording {
                VoiceRecordingTelemetryLabel(recorder: model.recorder)
                    .fixedSize()
            } else {
                HStack(spacing: 9) {
                    Image(systemName: recordingActionIcon)
                        .frame(width: 17, height: 20)
                    Text(recordingActionTitle)
                }
                .font(.system(size: 16, weight: .semibold))
                .fixedSize()
            }
        }
        .frame(width: 124, height: 52)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(recordingControlAccessibilityLabel)
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
            selectionAction("Agent", systemImage: "bubble.left.and.bubble.right", enabled: !selectedIds.isEmpty && !model.isReviewerDemoStorage) {
                model.conversations.draftFromVoice = selectedItems.map(\.text).joined(separator: "\n\n")
                exitSelection()
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

private struct TranscribingVoiceCard: View {
    let accent: Color
    let textColor: Color
    let reduceMotion: Bool
    let label: String
    @State private var shimmer = false

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            HStack(spacing: 8) {
                Circle()
                    .fill(accent)
                    .frame(width: 7, height: 7)
                    .opacity(reduceMotion || !shimmer ? 1 : 0.45)
                Text(label)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(textColor)
            }
            shimmerLine
            shimmerLine.frame(maxWidth: 210)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 116, alignment: .topLeading)
        .background(accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(accent.opacity(0.35), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label == "Transcribing…" ? "Transcribing" : label)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 1.7).repeatForever(autoreverses: false)) {
                shimmer = true
            }
        }
    }

    private var shimmerLine: some View {
        GeometryReader { geometry in
            RoundedRectangle(cornerRadius: 5)
                .fill(accent.opacity(0.12))
                .overlay {
                    LinearGradient(colors: [.clear, .white.opacity(0.5), .clear],
                                   startPoint: .leading, endPoint: .trailing)
                        .frame(width: geometry.size.width * 0.55)
                        .offset(x: shimmer ? geometry.size.width : -geometry.size.width)
                }
                .clipShape(RoundedRectangle(cornerRadius: 5))
        }
        .frame(height: 9)
    }
}

/// The voice item card, matching the old app's anatomy: time (or "Copied!"),
/// word count, action tag, cloud/Remote icons and a bottom-right expansion
/// chevron, with a 3-line clamp and last-words verification line.
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
        let measurement = RecordingStartupDiagnostics.startMeasurement(.rowDateFormatting)
        defer { measurement?.finish() }
        return Self.timeFormatter.string(from: item.createdAtMs.msToDate)
    }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter
    }()

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
        VStack(alignment: .leading, spacing: 9) {
            header
            Text(item.text)
                .font(.custom("Source Sans 3", size: 16))
                .foregroundStyle(Theme.text(colorScheme))
                .lineSpacing(4)
                .lineLimit(expanded ? nil : (wideLayout ? 5 : 3))
                .frame(maxWidth: .infinity, alignment: .leading)
            if needsExpansion || item.isStack {
                HStack(alignment: .bottom, spacing: 8) {
                    if let lastWords {
                        Button(action: onToggleExpand) {
                            Text("\(wordCount) words")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(Theme.textMuted(colorScheme).opacity(0.82))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2.5)
                                .background(Theme.textMuted(colorScheme).opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                        Text(lastWords)
                            .font(.custom("Source Sans 3", size: 14).italic())
                            .foregroundStyle(Theme.text(colorScheme))
                    }
                    Spacer(minLength: 0)
                    ZStack(alignment: .trailing) {
                        if needsExpansion && !expanded { expansionButton.fixedSize() }
                        if item.isStack { stackCount.padding(.trailing, needsExpansion ? 20 : 0) }
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: wideLayout ? 164 : nil, alignment: .top)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(selected ? accent.opacity(0.08) : Theme.background(colorScheme))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(
                            selected ? accent : Theme.border(colorScheme).opacity(0.72),
                            lineWidth: selected ? 1.5 : 0.75
                        )
                )
        )
        .overlay(alignment: .bottomTrailing) {
            if expanded && needsExpansion {
                Button(action: onToggleExpand) {
                    Text("Collapse")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.textMuted(colorScheme))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(Theme.background(colorScheme).opacity(0.96), in: Capsule())
                        .overlay(Capsule().strokeBorder(Theme.border(colorScheme).opacity(0.95), lineWidth: 0.8))
                        .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
                }
                .buttonStyle(.plain)
                .offset(x: -16, y: -16)
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

    @State private var showingDelivery = false
    @State private var showingDeliveryError = false

    private var deliveryError: String? {
        if actionLabel != "Complete", ["failed", "uncertain", "retry"].contains(item.currentAgentStatus ?? "") {
            return item.wasSentToAgent
                ? "The agent task encountered an error. Open Remote to inspect the task and retry there."
                : "Sending to the agent encountered an error. Open Remote to inspect delivery. Your transcript remains saved."
        }
        if !item.isCloudSaved, case .error(let message) = model.sync.status { return message }
        return nil
    }

    private var deliveryErrorButton: some View {
        Button { showingDeliveryError = true } label: {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 12)).foregroundStyle(.orange)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Delivery error")
        .alert("Delivery error", isPresented: $showingDeliveryError) {
            if !item.isCloudSaved { Button("Retry cloud save", action: onRequestCloudSave) }
            Button("OK", role: .cancel) {}
        } message: { Text(deliveryError ?? "Delivery will retry when possible.") }
    }

    private var hasEarlierSyncedRevision: Bool {
        (item.acknowledgedUpdatedAtMs ?? 0) > 0
            && item.acknowledgedUpdatedAtMs != item.updatedAtMs
    }

    private var actionLabel: String {
        VoiceDelivery.status(item: item, events: model.transcripts.events(for: item),
                             receipt: model.transcripts.receipt(for: item), eventsAlreadyOrdered: true)
    }

    /// The card communicates the user's next-relevant outcome. The delivery sheet
    /// still exposes the precise transport stage when that detail is useful.
    private var cardStatusLabel: String {
        if actionLabel == "Saved on phone", model.sync.status == .syncing { return "Syncing" }
        switch actionLabel {
        case "Saved on phone": return "Local"
        case "Uploaded", "Received by Mac", "Queued in Codex", "Sent to agent": return "Synced"
        case "Working": return "Working"
        case "Complete", "Saved as context": return "Done"
        case "Needs you": return "Needs input"
        case "Failed": return "Error"
        case "Cancelled", "Replaced by newer version": return "No longer current"
        default: return actionLabel
        }
    }

    private var cardStatusIsActive: Bool {
        ["Syncing", "Working"].contains(cardStatusLabel)
    }

    private var statusForeground: Color {
        switch cardStatusLabel {
        case "Send to agent", "Done":
            return Color(hex: 0x3E5D3B)
        case "Local":
            return Color(hex: 0x5F5B52)
        case "Syncing", "Synced":
            return Color(hex: 0x2E6B3D)
        case "Working":
            return Color(hex: 0x42647A)
        case "Needs input":
            return Color(hex: 0x9A622A)
        case "Error":
            return Color(hex: 0x963F38)
        default:
            return Theme.textMuted(colorScheme)
        }
    }

    private var statusIcon: String? {
        switch cardStatusLabel {
        case "Send to agent": return "arrow.up"
        case "Done": return "checkmark"
        case "Needs input": return "exclamationmark.triangle"
        case "Error": return "exclamationmark.circle"
        case "No longer current": return "arrow.triangle.2.circlepath"
        default: return nil
        }
    }

    private var statusIsAction: Bool { actionLabel == "Send to agent" }

    private var syncStateBadge: some View {
        Button {
            if actionLabel == "Send to agent" { onRequestCloudSync() }
            else { showingDelivery = true }
        } label: {
            HStack(spacing: 3) {
                if let statusIcon {
                    Image(systemName: statusIcon)
                        .font(.system(size: 9, weight: .semibold))
                }
                Text(cardStatusLabel)
                if cardStatusIsActive { DeliveryEllipsis() }
            }
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(statusForeground.opacity(statusIsAction ? 1 : 0.95))
            .padding(.horizontal, statusIsAction ? 8 : 6)
            .padding(.vertical, statusIsAction ? 3.5 : 2.5)
            .background(statusForeground.opacity(statusIsAction ? 0.035 : 0.11), in: RoundedRectangle(cornerRadius: statusIsAction ? 7 : 6))
            .overlay {
                if statusIsAction {
                    RoundedRectangle(cornerRadius: 7)
                        .strokeBorder(statusForeground.opacity(0.85), lineWidth: 0.75)
                }
            }
        }
        .buttonStyle(.borderless)
        .sheet(isPresented: $showingDelivery) { VoiceDeliveryView(item: item, onSend: onRequestCloudSync) }
        .fixedSize()
        .accessibilityLabel(cardStatusLabel)
        .accessibilityValue(item.actionPolicy)
        .accessibilityHint(actionLabel == "Send to agent" ? "Shows Send to agent option" : "Shows delivery timestamps and Mac observations")
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

    private var stackCount: some View {
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
        .accessibilityLabel("Stack count")
        .accessibilityValue(String(item.segments?.count ?? 0))
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(copied ? "Copied!" : timeLabel)
                .font(.system(size: 12, weight: copied ? .semibold : .regular))
                .foregroundStyle(copied ? Theme.link : Theme.textMuted(colorScheme).opacity(0.8))

            syncStateBadge

            Spacer()

            HStack(spacing: 8) {
                if deliveryError != nil { deliveryErrorButton }
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

/// The discard affordance fades in without animating the recording control.
private struct RecordingDismissFadeIn: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var visible = false

    func body(content: Content) -> some View {
        content
            .opacity(visible || reduceMotion ? 1 : 0)
            .onAppear {
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.55)) {
                    visible = true
                }
            }
            .onDisappear { visible = false }
    }
}

/// Status remains readable while taps are handled without invoking recording.
private struct VoiceStatusButtonStyle: ButtonStyle {
    let restingColor: Color
    let acknowledgeRecordTap: Bool
    let recording: Bool
    let startFailed: Bool

    func makeBody(configuration: Configuration) -> some View {
        StyleContent(configuration: configuration, restingColor: restingColor,
             acknowledgeRecordTap: acknowledgeRecordTap, recording: recording,
             startFailed: startFailed)
    }

    private struct StyleContent: View {
        let configuration: Configuration
        let restingColor: Color
        let acknowledgeRecordTap: Bool
        let recording: Bool
        let startFailed: Bool
        @State private var acknowledgedPress = false

        var body: some View {
            configuration.label
                .background {
                    RoundedRectangle(cornerRadius: 32)
                        .fill((configuration.isPressed && acknowledgeRecordTap) || acknowledgedPress
                              ? Theme.unread : restingColor)
                }
                .onChange(of: configuration.isPressed) { _, pressed in
                    if pressed && acknowledgeRecordTap { acknowledgedPress = true }
                }
                .onChange(of: recording) { _, isRecording in
                    if isRecording { acknowledgedPress = false }
                }
                .onChange(of: startFailed) { _, failed in
                    if failed { acknowledgedPress = false }
                }
        }
    }
}

/// A short history of measured microphone levels, not a decorative animation.
/// Keep frequent meter observations inside this subtree so they do not
/// invalidate the transcript list and the rest of the Voice screen.
private struct VoiceRecordingTelemetryLabel: View {
    let recorder: RecorderController
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var settled = false

    var body: some View {
        HStack(spacing: 12) {
            VoiceMicrophoneWaveform(level: recorder.level)
            Text(recorder.elapsed.clockString)
                .font(.system(size: 16, weight: .semibold, design: .monospaced))
            Image(systemName: "stop.fill")
                .font(.system(size: 17, weight: .semibold))
        }
        // Show the real controls on the first recording frame. Motion only
        // settles their position; it never gates capture or the Stop action.
        .offset(y: settled || reduceMotion ? 0 : 3)
        .scaleEffect(settled || reduceMotion ? 1 : 0.97)
        .onAppear {
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.14)) {
                settled = true
            }
        }
    }
}

private struct VoiceMicrophoneWaveform: View {
    let level: Float
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var samples: [Float] = Array(repeating: 0, count: 5)

    var body: some View {
        HStack(spacing: 2) {
            ForEach(samples.indices, id: \.self) { index in
                Capsule().frame(width: 2, height: 3 + CGFloat(samples[index]) * 19)
            }
        }
        .frame(width: 22, height: 24)
        .animation(reduceMotion ? nil : .linear(duration: 0.08), value: samples)
        .onChange(of: level, initial: true) { _, value in
            samples.removeFirst()
            samples.append(value.isFinite ? min(1, max(0, value)) : 0)
        }
        .accessibilityHidden(true)
    }
}
