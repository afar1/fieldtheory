import SwiftUI

enum AppTab: Hashable {
    case library, river, voice
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme

    @State private var selectedTab: AppTab = .library
    @State private var editorFocus = EditorFocusBus()
    @State private var toast = ToastCenter()
    @State private var showSettings = false

    var body: some View {
        Group {
            if model.showMainUI {
                mainTabs
            } else if model.auth.phase == .loading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.background(colorScheme))
            } else {
                SignInView()
            }
        }
        .environment(editorFocus)
        .environment(toast)
        .onAppear {
            wireRecorder()
            if model.launchDirectives.contains("ft-tab-river") { selectedTab = .river }
            if model.launchDirectives.contains("ft-tab-voice") { selectedTab = .voice }
        }
    }

    private var mainTabs: some View {
        TabView(selection: $selectedTab) {
            Tab("Library", systemImage: "books.vertical", value: AppTab.library) {
                LibraryView(showSettings: $showSettings)
            }
            Tab("River", systemImage: "water.waves", value: AppTab.river) {
                RiverView(showSettings: $showSettings)
            }
            .badge(model.river.unreadCount)
            Tab("Voice", systemImage: "waveform", value: AppTab.voice) {
                VoiceView(showSettings: $showSettings)
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .overlay(alignment: .bottomTrailing) {
            if selectedTab != .voice {
                FloatingMicButton()
                    .padding(.trailing, 18)
                    .padding(.bottom, 76)
            }
        }
        .overlay { ToastOverlay(toast: toast) }
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .environment(model)
                .environment(toast)
        }
        .task {
            model.recorder.models.ensureDownloaded()
        }
    }

    /// Transcript routing: cursor-focused editor wins; otherwise the words
    /// land in Voice as a fresh transcription.
    private func wireRecorder() {
        model.recorder.onTranscript = { text in
            if editorFocus.insert(text) {
                toast.show("Inserted", symbol: "text.cursor")
            } else {
                await model.transcripts.add(text: text)
                if model.settings.autoCopyTranscripts {
                    UIPasteboard.general.string = text
                }
                toast.show("Saved to Voice", symbol: "waveform")
            }
        }
        model.recorder.onNotice = { message, symbol in
            toast.show(message, symbol: symbol, duration: 2.6)
        }
    }
}

// MARK: - Floating mic (Library + River)

struct FloatingMicButton: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme

    private var accent: Color {
        Theme.accent(model.settings.accentPreset, colorScheme)
    }

    var body: some View {
        Button {
            model.recorder.toggle()
        } label: {
            label
                .shadow(color: .black.opacity(0.22), radius: 12, y: 5)
        }
        .buttonStyle(.plain)
        .animation(.spring(duration: 0.3), value: model.recorder.phase)
    }

    @ViewBuilder
    private var label: some View {
        switch model.recorder.phase {
        case .idle:
            idleLabel
        case .recording:
            recordingLabel
        case .transcribing:
            transcribingLabel
        }
    }

    private var idleLabel: some View {
        Image(systemName: "mic.fill")
            .font(.system(size: 21, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 54, height: 54)
            .background(accent, in: Circle())
    }

    private var recordingLabel: some View {
        HStack(spacing: 10) {
            WaveformBars(level: model.recorder.level, tint: .white)
            Text(model.recorder.elapsed.clockString)
                .font(.system(size: 15, weight: .semibold, design: .monospaced))
                .foregroundStyle(.white)
            Image(systemName: "stop.fill")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 18)
        .frame(height: 54)
        .background(Theme.unread, in: Capsule())
    }

    private var transcribingLabel: some View {
        ProgressView()
            .tint(.white)
            .frame(width: 54, height: 54)
            .background(accent.opacity(0.85), in: Circle())
    }
}

struct WaveformBars: View {
    let level: Float
    var tint: Color

    private func barHeight(time: Double, index: Int) -> CGFloat {
        let wobble: Double = 0.55 + 0.45 * sin(time * 9 + Double(index) * 1.4)
        let height: Double = 6.0 + Double(level) * 16.0 * wobble
        return CGFloat(max(5.0, height))
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.09)) { timeline in
            let time: Double = timeline.date.timeIntervalSince1970
            HStack(spacing: 2.5) {
                ForEach(0..<5, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(tint)
                        .frame(width: 3, height: barHeight(time: time, index: index))
                }
            }
        }
        .frame(height: 24)
    }
}

extension TimeInterval {
    var clockString: String {
        let total = Int(self)
        let minutes = total / 60
        let seconds = total % 60
        if minutes >= 60 {
            return String(format: "%d:%02d:%02d", minutes / 60, minutes % 60, seconds)
        }
        return String(format: "%d:%02d", minutes, seconds)
    }
}
