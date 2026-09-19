import AVFoundation
import ActivityKit
import AppIntents
import Foundation
import UIKit
import os

struct RecordingShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: StartFieldTheoryRecordingIntent(),
            phrases: ["Start recording with \(.applicationName)"],
            shortTitle: "Record in background", systemImageName: "mic.fill")
    }
}

/// Test entry point only: users explicitly assign this shortcut to their Action button.
@MainActor
final class BackgroundRecordingSession {
    static let shared = BackgroundRecordingSession()
    private var activity: Activity<RecordingActivityAttributes>?
    private let processLaunchID = UUID().uuidString
    private var diagnosticOrigin = "unknown"
    private var diagnosticAttempt = UUID().uuidString
    private var diagnosticStartedAt = ProcessInfo.processInfo.systemUptime
    private var starting = false
    private var captureSessionID: String?
    private let logger = Logger(subsystem: "com.afar1.fieldtheory", category: "BackgroundRecording")

    func start() async throws {
        guard !starting else { return }
        starting = true
        diagnosticOrigin = "intent"
        diagnosticAttempt = UUID().uuidString
        diagnosticStartedAt = ProcessInfo.processInfo.systemUptime
        recordEvidence("intent-entered")
        defer { starting = false }
        let model = AppModel.shared
        // Cold launches prepare the account's local storage before allowing microphone access.
        for _ in 0..<100 {
            if !model.isPreparingStorage { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        guard model.showMainUI, !model.isSigningOut, !model.isReviewerDemoStorage else {
            throw SpeechTranscriptionEngineError(message: "Open Field Theory and sign in before recording from the Action button.")
        }
        if model.recorder.phase == .recording { return }
        guard model.recorder.phase == .idle else {
            throw SpeechTranscriptionEngineError(message: "Wait for the current transcription to finish.")
        }
        guard model.recorder.canStartRecording else {
            throw SpeechTranscriptionEngineError(message: "The voice model is preparing. Open Field Theory and wait until it is ready.")
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            throw SpeechTranscriptionEngineError(message: "Enable Live Activities for Field Theory in iPhone Settings.")
        }
        for old in Activity<RecordingActivityAttributes>.activities {
            await old.end(nil, dismissalPolicy: .immediate)
        }
        recordEvidence("live-activity-requesting")
        let newActivity = try Activity.request(attributes: RecordingActivityAttributes(startedAt: Date()),
            content: ActivityContent(state: .init(status: "Starting recording…", recording: false), staleDate: nil), pushType: nil)
        activity = newActivity
        recordEvidence("live-activity-created")
        model.wireRecorderPersistence()
        model.recorder.onCaptureStopped = { [weak self] in self?.showProcessing() }
        model.recorder.onCaptureCancelled = { [weak self] in self?.cancelActivity() }
        model.recorder.onCaptureFinished = { [weak self] in self?.finish() }
        do {
            try await model.recorder.startFromIntent()
            captureSessionID = model.recorder.activeRecordingID
            recordEvidence("microphone-started")
            await newActivity.update(ActivityContent(state: .init(status: "Recording", recording: true), staleDate: nil))
            logger.notice("Microphone started; applicationState=\(UIApplication.shared.applicationState.rawValue)")
        } catch {
            activity = nil
            await newActivity.end(nil, dismissalPolicy: .immediate)
            recordEvidence("microphone-start-failed", error: error)
            logger.error("Microphone start failed: \(error.localizedDescription, privacy: .public)")
            throw error
        }
    }

    private func cancelActivity() {
        guard let activity else { return }
        self.activity = nil
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }

    /// An older build could leave its interactive result alive across suspension.
    /// Only completed results qualify; Starting/Recording/Transcribing stay owned
    /// by their current capture flow.
    func dismissCompletedActivities() async {
        for completed in Activity<RecordingActivityAttributes>.activities
            where completed.content.state.copyReady && !completed.content.state.recording {
            await completed.end(nil, dismissalPolicy: .immediate)
            if activity?.id == completed.id {
                activity = nil
                captureSessionID = nil
            }
            clearCompletedTranscript(for: completed.attributes.recordingID)
        }
    }

    func attachToForegroundRecording() {
        // The intent owns its Starting activity until capture and its update complete.
        guard !starting, UIApplication.shared.applicationState == .active else { return }
        if let activity, !activity.content.state.recording {
            self.activity = nil
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
        guard activity == nil, UIApplication.shared.applicationState == .active,
              let startedAt = AppModel.shared.recorder.startedAt,
              ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        do {
            captureSessionID = AppModel.shared.recorder.activeRecordingID
            let oldActivities = Activity<RecordingActivityAttributes>.activities
            for old in oldActivities { Task { await old.end(nil, dismissalPolicy: .immediate) } }
            activity = try Activity.request(attributes: RecordingActivityAttributes(startedAt: startedAt),
                content: ActivityContent(state: .init(status: "Recording", recording: true), staleDate: nil), pushType: nil)
            AppModel.shared.recorder.onCaptureStopped = { [weak self] in self?.showProcessing() }
            AppModel.shared.recorder.onCaptureCancelled = { [weak self] in self?.cancelActivity() }
            AppModel.shared.recorder.onCaptureFinished = { [weak self] in self?.finish() }
        } catch { logger.error("Live Activity unavailable: \(error.localizedDescription, privacy: .public)") }
    }

    func discard(recordingID: String, confirmed: Bool, keep: Bool) async {
        guard let activity, activity.attributes.recordingID == recordingID,
              let captureID = AppModel.shared.recorder.activeRecordingID else { return }
        if confirmed || (!keep && !AppModel.shared.settings.confirmBeforeDiscarding) {
            self.activity = nil
            await AppModel.shared.recorder.discardActiveRecording(expectedID: captureID)
            await activity.end(nil, dismissalPolicy: .immediate)
        } else {
            await activity.update(ActivityContent(state: .init(
                status: keep ? "Recording" : "Are you sure you want to discard this audio?",
                recording: true, confirmDiscard: !keep), staleDate: nil))
        }
    }

    func stop(recordingID: String = "", action: RecordingFinishAction? = nil) async {
        if !recordingID.isEmpty, activity?.attributes.recordingID != recordingID { return }
        let model = AppModel.shared
        // A duplicate tap while transcription starts must not end the result activity.
        guard model.recorder.phase == .recording else { return }
        if let action, let id = model.recorder.activeRecordingID {
            model.recorder.setFinishAction(action, expectedID: id)
        }
        await model.recorder.stopAndTranscribe()
    }

    private func showProcessing() {
        guard let activity else { return }
        recordEvidence("microphone-stopped")
        Task { await activity.update(ActivityContent(state: .init(status: "Transcribing…", recording: false), staleDate: nil)) }
    }

    private static let completedKey = "ft-live-activity-completed-transcript"

    func rememberCompletedTranscript(id: String, sessionID: String?, owner: UUID?, canSend: Bool) {
        guard let activity, let owner, let sessionID, sessionID == captureSessionID else { return }
        UserDefaults.standard.set(["activity": activity.attributes.recordingID,
            "transcript": id, "owner": owner.uuidString, "canSend": canSend ? "yes" : "no"],
            forKey: Self.completedKey)
    }

    func useCompletedTranscript(recordingID: String, send: Bool) async throws {
        let model = AppModel.shared
        for _ in 0..<100 {
            if !model.isPreparingStorage { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        guard model.showMainUI, !model.isSigningOut, !model.isReviewerDemoStorage,
              let saved = UserDefaults.standard.dictionary(forKey: Self.completedKey) as? [String: String],
              saved["activity"] == recordingID, saved["owner"] == model.auth.userId?.uuidString,
              let id = saved["transcript"],
              let live = Activity<RecordingActivityAttributes>.activities.first(where: {
                  $0.attributes.recordingID == recordingID && $0.content.state.copyReady
              }), let item = model.transcripts.items.first(where: { $0.id == id }) else {
            throw SpeechTranscriptionEngineError(message: "Open Field Theory to access this transcript.")
        }
        if send {
            guard live.content.state.sendReady else { return }
            guard await model.transcripts.requestCloudSync(id: id) else {
                throw SpeechTranscriptionEngineError(message: "The transcript could not be queued for sending.")
            }
            await model.sync.syncNow()
            // Also clean up a result activity left by an older app build.
            await live.end(nil, dismissalPolicy: .immediate)
            if activity?.id == live.id { activity = nil }
            clearCompletedTranscript(for: recordingID)
        } else {
            // The Copy intent opens the app because background clipboard writes fail on device.
            for _ in 0..<100 {
                if UIApplication.shared.applicationState == .active { break }
                try await Task.sleep(for: .milliseconds(50))
            }
            guard UIApplication.shared.applicationState == .active,
                  model.showMainUI, !model.isSigningOut,
                  saved["owner"] == model.auth.userId?.uuidString else {
                throw SpeechTranscriptionEngineError(message: "Open Field Theory to copy this transcript.")
            }
            let before = UIPasteboard.general.changeCount
            UIPasteboard.general.setItems([["public.utf8-plain-text": item.text]], options: [.localOnly: true])
            recordEvidence(UIPasteboard.general.changeCount != before
                ? "explicit-copy-counter-changed" : "explicit-copy-counter-unchanged")
            guard UIPasteboard.general.changeCount != before else {
                throw SpeechTranscriptionEngineError(message: "The transcript could not be copied. Try copying it in Field Theory.")
            }
            await live.end(nil, dismissalPolicy: .immediate)
            if activity?.id == live.id { activity = nil }
            if let current = UserDefaults.standard.dictionary(forKey: Self.completedKey) as? [String: String],
               current["activity"] == recordingID {
                UserDefaults.standard.removeObject(forKey: Self.completedKey)
            }
            recordEvidence("copied-activity-dismissed")
        }
    }

    private func finish() {
        guard let activity else { return }
        recordEvidence("processing-returned")
        self.activity = nil
        captureSessionID = nil
        clearCompletedTranscript(for: activity.attributes.recordingID)
        // End both the Dynamic Island and Lock Screen presentation without a
        // timer, which could stall when the app is suspended. Saved transcripts
        // and retryable audio remain available in the app.
        let allowance = VoiceModelPreparationAllowance(name: "Dismiss recording status")
        Task {
            defer { allowance.end() }
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    private func clearCompletedTranscript(for recordingID: String) {
        if let saved = UserDefaults.standard.dictionary(forKey: Self.completedKey) as? [String: String],
           saved["activity"] == recordingID {
            UserDefaults.standard.removeObject(forKey: Self.completedKey)
        }
    }

    /// Content-free device evidence; no audio or transcript is copied into diagnostics.
    func beginCaptureDiagnostics() {
        // Intent starts already have an attempt ID; in-app starts need their own.
        if !starting {
            diagnosticOrigin = "in-app"
            diagnosticAttempt = UUID().uuidString
            diagnosticStartedAt = ProcessInfo.processInfo.systemUptime
        }
        recordEvidence("capture-start-entered")
    }

    /// Capture UI/attempt identity before audio work leaves the main actor.
    /// Each invocation snapshots audio state on the capture owner's executor.
    func makeCaptureEvidenceRecorder() -> @Sendable (String, Error?, [String: Any]) -> Void {
        let context = RecordingEvidenceContext(base: diagnosticContext(), startedAt: diagnosticStartedAt)
        return { event, error, details in
            RecordingEvidenceWriter.shared.append(context.entry(event, error: error, details: details))
        }
    }

    func recordEvidence(_ event: String, error: Error? = nil, details: [String: Any] = [:]) {
        let context = RecordingEvidenceContext(base: diagnosticContext(), startedAt: diagnosticStartedAt)
        let uptime = ProcessInfo.processInfo.systemUptime
        let date = Date()
        // Give queued writes a finite allowance when the app moves to the background.
        let allowance = VoiceModelPreparationAllowance(name: "Recording diagnostics")
        RecordingEvidenceWriter.shared.append(makeEntry: {
            context.entry(event, error: error, details: details, uptime: uptime, date: date)
        }) {
            DispatchQueue.main.async {
                allowance.end()
            }
        }
    }

    private func diagnosticContext() -> [String: Any] {
        ["contextCapturedAtUptimeSeconds": ProcessInfo.processInfo.systemUptime,
         "attemptID": diagnosticAttempt,
         "origin": diagnosticOrigin,
         "processID": ProcessInfo.processInfo.processIdentifier,
         "processLaunchID": processLaunchID,
         "phase": String(describing: AppModel.shared.recorder.phase),
         "ownedActivityID": activity?.id ?? "none",
         "liveActivitiesEnabled": ActivityAuthorizationInfo().areActivitiesEnabled,
         "liveActivityStates": Activity<RecordingActivityAttributes>.activities.map { String(describing: $0.activityState) },
         "applicationState": UIApplication.shared.applicationState.rawValue,
         "protectedDataAvailable": UIApplication.shared.isProtectedDataAvailable,
         "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
         "elapsedSeconds": AppModel.shared.recorder.elapsed,
         "pendingSessions": AppModel.shared.recorder.pendingSessionCount]
    }
}

/// Immutable JSON-compatible values captured before crossing executors.
/// No UIKit or mutable model references are carried into the writer.
private struct RecordingEvidenceContext: @unchecked Sendable {
    let base: [String: Any]
    let startedAt: TimeInterval

    func entry(_ event: String, error: Error?, details: [String: Any],
               uptime: TimeInterval = ProcessInfo.processInfo.systemUptime, date: Date = Date()) -> [String: Any] {
        let audio = AVAudioSession.sharedInstance()
        var entry = base
        entry.merge([
            "event": event,
            "attemptElapsedSeconds": uptime - startedAt,
            "systemUptimeSeconds": uptime,
            "timestamp": ISO8601DateFormatter().string(from: date),
            "audioSnapshotUptimeSeconds": ProcessInfo.processInfo.systemUptime,
            "microphonePermission": AVAudioApplication.shared.recordPermission.rawValue,
            "audioCategory": audio.category.rawValue,
            "audioMode": audio.mode.rawValue,
            "audioOptions": audio.categoryOptions.rawValue,
            "inputAvailable": audio.isInputAvailable,
            "sampleRate": audio.sampleRate,
            "inputChannels": audio.inputNumberOfChannels,
            "otherAudioPlaying": audio.isOtherAudioPlaying,
            "secondaryAudioSilenced": audio.secondaryAudioShouldBeSilencedHint,
            "inputPortTypes": audio.currentRoute.inputs.map { $0.portType.rawValue },
            "outputPortTypes": audio.currentRoute.outputs.map { $0.portType.rawValue },
        ]) { _, new in new }
        entry.merge(details) { existing, _ in existing }
        if let error {
            let nsError = error as NSError
            entry["error"] = nsError.localizedDescription
            entry["errorDomain"] = nsError.domain
            entry["errorCode"] = nsError.code
        }
        return entry
    }
}

/// A single queue preserves event order without JSON reads/writes on the UI thread.
final class RecordingEvidenceWriter: @unchecked Sendable {
    static let shared = RecordingEvidenceWriter(url: RecorderController.voiceDiagnosticsDir.appendingPathComponent("background-recording.json"))
    private let queue = DispatchQueue(label: "com.afar1.fieldtheory.recording-evidence", qos: .utility)
    private let url: URL
    private let logger = Logger(subsystem: "com.afar1.fieldtheory", category: "RecordingEvidence")

    init(url: URL) { self.url = url }

    func flush() async {
        await withCheckedContinuation { continuation in
            queue.async { continuation.resume() }
        }
    }

    func append(_ entry: [String: Any], completion: @escaping @Sendable () -> Void = {}) {
        append(makeEntry: { entry }, completion: completion)
    }

    func append(makeEntry: @escaping @Sendable () -> [String: Any], completion: @escaping @Sendable () -> Void = {}) {
        queue.async { [self] in
            defer { completion() }
            let entry = makeEntry()
            do {
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                var events = (try? Data(contentsOf: url))
                    .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [[String: Any]] } ?? []
                events.append(entry)
                try JSONSerialization.data(withJSONObject: Array(events.suffix(150)), options: [.prettyPrinted, .sortedKeys])
                    .write(to: url, options: .atomic)
            } catch { logger.error("Could not write recording diagnostics") }
        }
    }
}
