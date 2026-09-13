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
                Image(systemName: context.state.symbol)
                    .foregroundStyle(.orange)
                VStack(alignment: .leading) {
                    Text("Field Theory").font(.headline)
                    Text(context.state.status).font(.caption)
                }
                Spacer()
                if context.state.recording {
                    Text(context.attributes.startedAt, style: .timer).monospacedDigit().frame(width: 70)
                    recordingButtons(context)

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
                    VStack(alignment: .leading, spacing: 8) {
                        Text(context.state.status)
                        Spacer()
                        if context.state.recording {
                            recordingButtons(context)
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: context.state.symbol).foregroundStyle(.orange)
            } compactTrailing: {
                if context.state.recording {
                    Text(context.attributes.startedAt, style: .timer).monospacedDigit().frame(width: 48)
                } else { Image(systemName: context.state.symbol) }
            } minimal: {
                Image(systemName: context.state.symbol).foregroundStyle(.orange)
            }
        }
    }
    @ViewBuilder
    private func recordingButtons(_ context: ActivityViewContext<RecordingActivityAttributes>) -> some View {
        if context.state.confirmDiscard {
            Button(intent: DiscardFieldTheoryRecordingIntent(recordingID: context.attributes.recordingID, keep: true)) {
                Text("Keep")
            }
            Button(intent: DiscardFieldTheoryRecordingIntent(recordingID: context.attributes.recordingID, confirmed: true)) {
                Text("Discard")
            }.tint(.red)
        } else {
            Button(intent: DiscardFieldTheoryRecordingIntent(recordingID: context.attributes.recordingID)) {
                Image(systemName: "xmark").frame(width: 32, height: 32)
                    .background(.white.opacity(0.15), in: Circle())
            }.buttonStyle(.plain).accessibilityLabel("Cancel recording")
            Button(intent: StopFieldTheoryRecordingIntent()) { Image(systemName: "stop.fill") }
                .tint(.red).accessibilityLabel("Stop recording")
        }
    }

}
