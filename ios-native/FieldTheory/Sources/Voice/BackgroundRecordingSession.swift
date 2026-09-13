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
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            throw SpeechTranscriptionEngineError(message: "Enable Live Activities for Field Theory in iPhone Settings.")
        }
        for old in Activity<RecordingActivityAttributes>.activities {
            await old.end(nil, dismissalPolicy: .immediate)
        }
        let newActivity = try Activity.request(attributes: RecordingActivityAttributes(startedAt: Date()),
            content: ActivityContent(state: .init(status: "Recording", recording: true), staleDate: nil), pushType: nil)
        activity = newActivity
        model.wireRecorderPersistence()
        model.recorder.onCaptureStopped = { [weak self] in self?.showProcessing() }
        model.recorder.onCaptureCancelled = { [weak self] in self?.cancelActivity() }
        model.recorder.onCaptureFinished = { [weak self] in self?.finish() }
        do {
            try model.recorder.startFromIntent()
            captureSessionID = model.recorder.activeRecordingID
            recordEvidence("microphone-started")
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

    func attachToForegroundRecording() {
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
            AppModel.shared.recorder.discardActiveRecording(expectedID: captureID)
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
        guard model.recorder.phase == .recording else {
            for old in Activity<RecordingActivityAttributes>.activities {
                await old.end(nil, dismissalPolicy: .immediate)
            }
            return
        }
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

    private func finish() {
        guard let activity else { return }
        self.activity = nil
        recordEvidence("processing-returned")
        let pending = AppModel.shared.recorder.pendingSessionCount > 0
        let transcribed = captureSessionID != nil && AppModel.shared.recorder.lastTranscribedSessionID == captureSessionID
        let state = RecordingActivityAttributes.ContentState(
            status: transcribed ? "Transcribed" : (pending ? "Audio saved — open to finish" : "No speech detected"), recording: false)
        Task { await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(30))) }
    }

    /// Content-free device evidence; no audio or transcript is copied into diagnostics.
    private func recordEvidence(_ event: String, error: Error? = nil) {
        let directory = RecorderController.voiceDiagnosticsDir
        let url = directory.appendingPathComponent("background-recording.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var events = (try? Data(contentsOf: url))
                .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [[String: Any]] } ?? []
            var entry: [String: Any] = ["event": event,
                "timestamp": ISO8601DateFormatter().string(from: Date()),
                "applicationState": UIApplication.shared.applicationState.rawValue,
                "protectedDataAvailable": UIApplication.shared.isProtectedDataAvailable,
                "systemUptimeSeconds": ProcessInfo.processInfo.systemUptime,
                "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
                "elapsedSeconds": AppModel.shared.recorder.elapsed,
                "pendingSessions": AppModel.shared.recorder.pendingSessionCount]
            if let error {
                let nsError = error as NSError
                entry["error"] = nsError.localizedDescription
                entry["errorDomain"] = nsError.domain
                entry["errorCode"] = nsError.code
            }
            events.append(entry)
            try JSONSerialization.data(withJSONObject: Array(events.suffix(30)), options: [.prettyPrinted, .sortedKeys])
                .write(to: url, options: .atomic)
        } catch { logger.error("Could not write recording diagnostics") }
    }

}
