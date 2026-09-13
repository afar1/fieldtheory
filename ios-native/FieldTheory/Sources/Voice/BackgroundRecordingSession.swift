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
        model.recorder.onCaptureFinished = { [weak self] in self?.finish() }
        do {
            try model.recorder.startFromIntent()
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

    func stop() async {
        let model = AppModel.shared
        guard model.recorder.phase == .recording else {
            for old in Activity<RecordingActivityAttributes>.activities {
                await old.end(nil, dismissalPolicy: .immediate)
            }
            return
        }
        await model.recorder.stopAndTranscribe()
    }

    private func showProcessing() {
        guard let activity else { return }
        recordEvidence("microphone-stopped")
        Task { await activity.update(ActivityContent(state: .init(status: "Saving audio…", recording: false), staleDate: nil)) }
    }

    private func finish() {
        guard let activity else { return }
        self.activity = nil
        recordEvidence("processing-returned")
        let pending = AppModel.shared.recorder.pendingSessionCount > 0
        let state = RecordingActivityAttributes.ContentState(
            status: pending ? "Audio saved — open to finish" : "Finished", recording: false)
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
