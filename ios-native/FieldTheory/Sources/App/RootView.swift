import SwiftUI

/// Retained for dormant Library/River source compatibility. Voice-only
/// navigation does not install an edge-swipe gesture or expose those routes.
enum EdgeSwipe {
    static let zoneWidth: CGFloat = 30
}

/// Tracks pushed reading surfaces retained by the underlying Library and River
/// implementations. Voice-only navigation does not enter those surfaces.
@MainActor
@Observable
final class ReadingState {
    private var depth = 0
    var isReading: Bool { depth > 0 }
    func enter() { depth += 1 }
    func exit() { depth = max(0, depth - 1) }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    // These environment objects remain available to the retained underlying
    // Library and River types, but no public route reaches those features.
    @State private var editorFocus = EditorFocusBus()
    @State private var toast = ToastCenter()
    @State private var readingState = ReadingState()
    @State private var showSettings = false

    var body: some View {
        Group {
            if model.isSigningOut {
                ProgressView("Signing out…")
            } else if model.isPreparingStorage {
                ProgressView("Preparing Field Theory…")
            } else if model.storageAccessBlocked {
                storageRecovery
            } else if model.showMainUI {
                voiceWorkspace.id(model.workspaceGeneration)
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
        .environment(readingState)
        .preferredColorScheme(model.settings.appearanceMode.colorScheme)
        .onAppear { wireRecorder() }
        .onChange(of: model.workspaceGeneration) { _, _ in
            // Workspace-local callbacks must not survive an account or
            // Reviewer Demo storage swap.
            editorFocus = EditorFocusBus()
            readingState = ReadingState()
            showSettings = false
            wireRecorder()
        }
        .onChange(of: ObjectIdentifier(model.recorder)) { _, _ in
            wireRecorder()
        }
        .alert("Local storage needs attention", isPresented: Binding(
            get: { model.storageAlert != nil },
            set: { if !$0 { model.storageAlert = nil } }
        )) {
            Button("OK") { model.storageAlert = nil }
        } message: {
            Text(model.storageAlert?.message ?? "")
        }
    }

    private var storageRecovery: some View {
        ContentUnavailableView {
            Label("Local storage unavailable", systemImage: "externaldrive.badge.exclamationmark")
        } description: {
            Text("Your existing files were left unchanged. Check available device storage, then try again or relaunch Field Theory.")
        } actions: {
            Button("Try again") {
                Task { await model.retryStoragePreparation() }
            }
            .buttonStyle(.borderedProminent)
            if model.auth.hasIdentity {
                Button("Sign out", role: .destructive) {
                    Task { await model.signOutCompletely() }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background(colorScheme))
    }

    private var voiceWorkspace: some View {
        VoiceView(showSettings: $showSettings)
            .overlay { ToastOverlay(toast: toast) }
            .sheet(isPresented: $showSettings) {
                SettingsView()
                    .environment(model)
                    .environment(toast)
                    .frame(idealWidth: horizontalSizeClass == .regular ? 560 : nil,
                           idealHeight: horizontalSizeClass == .regular ? 720 : nil)
            }
    }

    /// Voice recordings always produce a local transcript in the active
    /// workspace. There is no longer an editor route that can receive text.
    private func wireRecorder() {
        let recorder = model.recorder
        model.wireRecorderPersistence()
        let workspace = model.workspaceGeneration
        recorder.onNotice = { message, symbol in
            guard model.workspaceGeneration == workspace else { return }
            toast.show(message, symbol: symbol, duration: 2.6)
        }
        Task { await recorder.resumePendingWork() }
    }
}

// MARK: - Floating mic (Library + River)

/// The mic floats wherever you drop it; the perch persists across launches
/// and rides above the keyboard automatically.
struct DraggableMicOverlay: View {
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var dragOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geometry in
            let home = restingPoint(in: geometry.size)
            FloatingMicButton()
                .position(x: home.x + dragOffset.width, y: home.y + dragOffset.height)
                .gesture(
                    DragGesture(minimumDistance: 10)
                        .onChanged { value in
                            dragOffset = value.translation
                        }
                        .onEnded { value in
                            let landed = clamp(
                                CGPoint(x: home.x + value.translation.width,
                                        y: home.y + value.translation.height),
                                in: geometry.size
                            )
                            model.settings.micPositionFraction = CGPoint(
                                x: landed.x / max(geometry.size.width, 1),
                                y: landed.y / max(geometry.size.height, 1)
                            )
                            dragOffset = .zero
                        }
                )
        }
    }

    private func restingPoint(in size: CGSize) -> CGPoint {
        let fallback = horizontalSizeClass == .regular
            ? CGPoint(x: 0.93, y: 0.9)
            : CGPoint(x: 0.86, y: 0.84)
        let fraction = model.settings.micPositionFraction ?? fallback
        return clamp(CGPoint(x: fraction.x * size.width, y: fraction.y * size.height), in: size)
    }

    private func clamp(_ point: CGPoint, in size: CGSize) -> CGPoint {
        CGPoint(
            x: min(max(point.x, 44), size.width - 44),
            y: min(max(point.y, 60), size.height - 44)
        )
    }
}

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
        .hoverEffect(.lift)
        .keyboardShortcut("r", modifiers: [.command, .shift])
        .accessibilityLabel(model.recorder.phase == .recording ? "Stop recording" : "Start recording")
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
