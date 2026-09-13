import ActivityKit
import AppIntents
import Foundation

struct RecordingActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var status: String
        var recording: Bool
    }
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
