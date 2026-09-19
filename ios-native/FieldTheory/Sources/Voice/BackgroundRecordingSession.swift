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
    private var starting = false
    private var captureSessionID: String?
    private let logger = Logger(subsystem: "com.afar1.fieldtheory", category: "BackgroundRecording")

    func start() async throws {
        guard !starting else { return }
        starting = true
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
        let newActivity = try Activity.request(attributes: RecordingActivityAttributes(startedAt: Date()),
            content: ActivityContent(state: .init(status: "Starting recording…", recording: false), staleDate: nil), pushType: nil)
        activity = newActivity
        model.wireRecorderPersistence()
        model.recorder.onCaptureStopped = { [weak self] in self?.showProcessing() }
        model.recorder.onCaptureCancelled = { [weak self] in self?.cancelActivity() }
        model.recorder.onCaptureFinished = { [weak self] in self?.finish() }
        do {
            try await model.recorder.startFromIntent()
            captureSessionID = model.recorder.activeRecordingID
            await newActivity.update(ActivityContent(state: .init(status: "Recording", recording: true), staleDate: nil))
            logger.notice("Microphone started; applicationState=\(UIApplication.shared.applicationState.rawValue)")
        } catch {
            activity = nil
            await newActivity.end(nil, dismissalPolicy: .immediate)
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
            guard UIPasteboard.general.changeCount != before else {
                throw SpeechTranscriptionEngineError(message: "The transcript could not be copied. Try copying it in Field Theory.")
            }
            await live.end(nil, dismissalPolicy: .immediate)
            if activity?.id == live.id { activity = nil }
            if let current = UserDefaults.standard.dictionary(forKey: Self.completedKey) as? [String: String],
               current["activity"] == recordingID {
                UserDefaults.standard.removeObject(forKey: Self.completedKey)
            }
        }
    }

    private func finish() {
        guard let activity else { return }
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

}
