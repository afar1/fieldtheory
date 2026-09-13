import ActivityKit
import SwiftUI
import WidgetKit

@main
struct RecordingWidgets: WidgetBundle {
    var body: some Widget { RecordingLiveActivity() }
}

struct RecordingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            HStack {
                Image(systemName: context.state.recording ? "mic.fill" : "checkmark")
                    .foregroundStyle(.orange)
                VStack(alignment: .leading) {
                    Text("Field Theory").font(.headline)
                    Text(context.state.status).font(.caption)
                }
                Spacer()
                if context.state.recording {
                    Text(context.attributes.startedAt, style: .timer).monospacedDigit().frame(width: 70)
                    Button(intent: StopFieldTheoryRecordingIntent()) { Image(systemName: "stop.fill") }
                        .tint(.red).accessibilityLabel("Stop recording")
                }
            }.padding().activityBackgroundTint(.black).activitySystemActionForegroundColor(.white)
                .foregroundStyle(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("Field Theory", systemImage: "mic.fill").foregroundStyle(.orange)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if context.state.recording {
                        Text(context.attributes.startedAt, style: .timer).monospacedDigit()
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(context.state.status)
                        Spacer()
                        if context.state.recording {
                            Button(intent: StopFieldTheoryRecordingIntent()) {
                                Label("Stop", systemImage: "stop.fill")
                            }.tint(.red)
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: context.state.recording ? "mic.fill" : "checkmark").foregroundStyle(.orange)
            } compactTrailing: {
                if context.state.recording {
                    Text(context.attributes.startedAt, style: .timer).monospacedDigit().frame(width: 48)
                } else { Image(systemName: "checkmark") }
            } minimal: {
                Image(systemName: context.state.recording ? "mic.fill" : "checkmark").foregroundStyle(.orange)
            }
        }
    }
}
