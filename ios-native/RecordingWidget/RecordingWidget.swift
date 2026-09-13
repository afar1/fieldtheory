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
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center) {
                    title(context)
                    Spacer(minLength: 12)
                    timer(context)
                }
                detail(context)
            }
            .padding(16)
            .foregroundStyle(.white)
            .activityBackgroundTint(.black)
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    title(context).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    timer(context).padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    detail(context).padding(.horizontal, 4).padding(.top, 8)
                }
            } compactLeading: {
                Image(systemName: context.state.symbol).foregroundStyle(tint(context))
            } compactTrailing: {
                if context.state.recording {
                    Text(context.attributes.startedAt, style: .timer)
                        .monospacedDigit().font(.caption2).frame(width: 48)
                } else {
                    Image(systemName: context.state.symbol).foregroundStyle(tint(context))
                }
            } minimal: {
                Image(systemName: context.state.symbol).foregroundStyle(tint(context))
            }
            .keylineTint(tint(context))
        }
    }

    private func tint(_ context: ActivityViewContext<RecordingActivityAttributes>) -> Color {
        context.state.status.hasPrefix("Transcribed") ? .green : .orange
    }

    private func title(_ context: ActivityViewContext<RecordingActivityAttributes>) -> some View {
        HStack(spacing: 8) {
            Image(systemName: context.state.symbol).foregroundStyle(tint(context))
            VStack(alignment: .leading, spacing: 2) {
                Text("Field Theory").font(.subheadline.weight(.semibold))
                Text(context.state.recording ? "Finish recording" : context.state.status)
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func timer(_ context: ActivityViewContext<RecordingActivityAttributes>) -> some View {
        if context.state.recording {
            Text(context.attributes.startedAt, style: .timer)
                .font(.system(.title3, design: .monospaced).weight(.medium))
                .multilineTextAlignment(.trailing).frame(width: 90)
                .accessibilityLabel("Recording time")
        }
    }

    @ViewBuilder
    private func detail(_ context: ActivityViewContext<RecordingActivityAttributes>) -> some View {
        if context.state.recording {
            VStack(alignment: .leading, spacing: 12) {
                if context.state.confirmDiscard {
                    Text("Are you sure you want to discard this audio?")
                        .font(.subheadline).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 12) {
                        Button(intent: DiscardFieldTheoryRecordingIntent(recordingID: context.attributes.recordingID, keep: true)) {
                            Text("Keep recording").frame(maxWidth: .infinity, minHeight: 44)
                                .background(.white.opacity(0.14), in: Capsule())
                        }
                        Button(intent: DiscardFieldTheoryRecordingIntent(recordingID: context.attributes.recordingID, confirmed: true)) {
                            Text("Discard").frame(maxWidth: .infinity, minHeight: 44)
                                .background(.red, in: Capsule())
                        }
                    }
                } else {
                    HStack(spacing: 12) {
                        Button(intent: DiscardFieldTheoryRecordingIntent(recordingID: context.attributes.recordingID)) {
                            Image(systemName: "xmark").font(.body.weight(.semibold))
                                .frame(width: 44, height: 44)
                                .background(.white.opacity(0.14), in: Circle())
                        }.accessibilityLabel("Cancel recording")
                        Button(intent: CopyFieldTheoryRecordingIntent(recordingID: context.attributes.recordingID)) {
                            Label("Copy", systemImage: "doc.on.doc")
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .background(.white.opacity(0.14), in: Capsule())
                        }.accessibilityLabel("Finish recording and copy transcript")
                        Button(intent: SendFieldTheoryRecordingIntent(recordingID: context.attributes.recordingID)) {
                            Label("Send", systemImage: "paperplane")
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .background(.white, in: Capsule()).foregroundStyle(.black)
                        }.accessibilityLabel("Finish recording and send to computer")
                    }
                }
            }
            .buttonStyle(.plain)
            .foregroundStyle(.white)
        }
    }
}
