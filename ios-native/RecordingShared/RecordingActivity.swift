import ActivityKit
import AppIntents
import Foundation

struct RecordingActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var status: String
        var recording: Bool
        var confirmDiscard: Bool = false
        var symbol: String { recording ? "mic.fill" : (status == "Transcribed" ? "checkmark" : "clock") }
    }
    var recordingID = UUID().uuidString
    let startedAt: Date
}

struct StartFieldTheoryRecordingIntent: AudioRecordingIntent, LiveActivityIntent {
    static var title: LocalizedStringResource = "Start recording in background"
    static var description = IntentDescription("Test recording with Field Theory while staying in your current app.")
    static var openAppWhenRun: Bool = false
    @MainActor
    func perform() async throws -> some IntentResult {
#if !WIDGET_EXTENSION
        try await BackgroundRecordingSession.shared.start()
#endif
        return .result()
    }
}

struct StopFieldTheoryRecordingIntent: AudioRecordingIntent, LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop recording"
    static var openAppWhenRun: Bool = false
    @MainActor
    func perform() async throws -> some IntentResult {
#if !WIDGET_EXTENSION
        await BackgroundRecordingSession.shared.stop()
#endif
        return .result()
    }
}

struct DiscardFieldTheoryRecordingIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Discard recording"
    static var openAppWhenRun: Bool = false
    @Parameter(title: "Recording") var recordingID: String
    @Parameter(title: "Confirm") var confirmed: Bool
    @Parameter(title: "Keep recording") var keep: Bool
    init() {}
    init(recordingID: String, confirmed: Bool = false, keep: Bool = false) {
        self.recordingID = recordingID; self.confirmed = confirmed; self.keep = keep
    }
    @MainActor
    func perform() async throws -> some IntentResult {
#if !WIDGET_EXTENSION
        await BackgroundRecordingSession.shared.discard(recordingID: recordingID, confirmed: confirmed, keep: keep)
#endif
        return .result()
    }
}
