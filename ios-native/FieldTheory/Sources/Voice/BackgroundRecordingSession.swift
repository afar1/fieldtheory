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
    private var diagnosticAttempt = UUID().uuidString
    private var diagnosticStartedAt = ProcessInfo.processInfo.systemUptime
    private var starting = false
    private var captureSessionID: String?
    private let logger = Logger(subsystem: "com.afar1.fieldtheory", category: "BackgroundRecording")

    func start() async throws {
        guard !starting else { return }
        starting = true
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
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            throw SpeechTranscriptionEngineError(message: "Enable Live Activities for Field Theory in iPhone Settings.")
        }
        for old in Activity<RecordingActivityAttributes>.activities {
            await old.end(nil, dismissalPolicy: .immediate)
        }
        recordEvidence("live-activity-requesting")
        let newActivity = try Activity.request(attributes: RecordingActivityAttributes(startedAt: Date()),
            content: ActivityContent(state: .init(status: "Recording", recording: true), staleDate: nil), pushType: nil)
        activity = newActivity
        recordEvidence("live-activity-created")
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
            await live.update(ActivityContent(state: .init(status: "Transcribed", recording: false,
                copyReady: true, sendReady: false), staleDate: Date().addingTimeInterval(300)))
            await model.sync.syncNow()
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
        }
    }

    private func finish() {
        guard let activity else { return }
        recordEvidence("processing-returned")
        let pending = AppModel.shared.recorder.pendingSessionCount > 0
        let transcribed = captureSessionID != nil && AppModel.shared.recorder.lastTranscribedSessionID == captureSessionID
        let saved = UserDefaults.standard.dictionary(forKey: Self.completedKey) as? [String: String]
        let ready = transcribed && saved?["activity"] == activity.attributes.recordingID
        let state = RecordingActivityAttributes.ContentState(
            status: transcribed ? "Transcribed" : (pending ? "Audio saved — open to finish" : "No speech detected"),
            recording: false, copyReady: ready, sendReady: ready && saved?["canSend"] == "yes")
        if ready {
            // Ended Live Activities cannot run buttons. Keep this result interactive for five minutes.
            Task {
                await activity.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(300)))
                try? await Task.sleep(for: .seconds(300))
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        } else {
            self.activity = nil
            Task { await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(30))) }
        }
    }

    /// Content-free device evidence; no audio or transcript is copied into diagnostics.
    func recordEvidence(_ event: String, error: Error? = nil) {
        let directory = RecorderController.voiceDiagnosticsDir
        let url = directory.appendingPathComponent("background-recording.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var events = (try? Data(contentsOf: url))
                .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [[String: Any]] } ?? []
            let audio = AVAudioSession.sharedInstance()
            var entry: [String: Any] = ["event": event,
                "attemptID": diagnosticAttempt,
                "attemptElapsedSeconds": ProcessInfo.processInfo.systemUptime - diagnosticStartedAt,
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
                "liveActivitiesEnabled": ActivityAuthorizationInfo().areActivitiesEnabled,
                "liveActivityStates": Activity<RecordingActivityAttributes>.activities.map { String(describing: $0.activityState) },
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
            try JSONSerialization.data(withJSONObject: Array(events.suffix(150)), options: [.prettyPrinted, .sortedKeys])
                .write(to: url, options: .atomic)
        } catch { logger.error("Could not write recording diagnostics") }
    }

}
