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
                // The bottom region spans the Island's full width below the camera.
                // Long titles do not fit in the narrow leading region beside the cutout.
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(alignment: .center, spacing: 8) {
                            title(context).layoutPriority(1)
                            Spacer(minLength: 4)
                            timer(context)
                        }
                        detail(context)
                    }.padding(.horizontal, 4).padding(.top, 4)
                }
            } compactLeading: {
                Image(systemName: context.state.symbol).foregroundStyle(tint(context))
            } compactTrailing: {
                if context.state.recording {
                    Text(context.attributes.startedAt, style: .timer)
                        .monospacedDigit().font(.caption2).frame(width: 48)
                } else {
                    Text(context.state.copyReady ? "Done" : "…")
                        .font(.caption2).foregroundStyle(.secondary)
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
                    .fixedSize(horizontal: false, vertical: true)
                Text(context.state.recording ? "Recording" : context.state.status)
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
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
                    HStack(spacing: 8) {
                        Button(intent: DiscardFieldTheoryRecordingIntent(recordingID: context.attributes.recordingID, keep: true)) {
                            Text("Keep recording").font(.caption.weight(.semibold)).frame(width: 108, height: 44)
                                .background(.white.opacity(0.14), in: Capsule())
                        }
                        Button(intent: DiscardFieldTheoryRecordingIntent(recordingID: context.attributes.recordingID, confirmed: true)) {
                            Text("Discard").font(.caption.weight(.semibold)).frame(width: 108, height: 44)
                                .background(.red, in: Capsule())
                        }
                    }
                } else {
                    HStack(spacing: 8) {
                        Button(intent: DiscardFieldTheoryRecordingIntent(recordingID: context.attributes.recordingID)) {
                            Image(systemName: "xmark").font(.body.weight(.semibold))
                                .frame(width: 44, height: 44)
                                .background(.white.opacity(0.14), in: Circle())
                        }.accessibilityLabel("Cancel recording")
                        Spacer(minLength: 8)
                        Button(intent: StopFieldTheoryRecordingIntent(recordingID: context.attributes.recordingID)) {
                            HStack(spacing: 6) {
                                Image(systemName: "stop.fill").font(.caption2)
                                Text("Stop")
                            }
                            .font(.caption.weight(.semibold))
                            .frame(width: 108, height: 44)
                            .background(.white.opacity(0.14), in: Capsule())
                        }.accessibilityLabel("Stop and transcribe without sending to agent")
                        Button(intent: SendFieldTheoryRecordingIntent(recordingID: context.attributes.recordingID)) {
                            HStack(spacing: 6) {
                                Image(systemName: "stop.fill").font(.caption2)
                                Image(systemName: "plus").font(.system(size: 9, weight: .medium))
                                Image(systemName: "paperplane").font(.caption)
                                Text("Send")
                            }
                            .font(.caption.weight(.semibold))
                            .frame(width: 108, height: 44)
                            .background(.white, in: Capsule()).foregroundStyle(.black)
                        }.accessibilityLabel("Stop, transcribe and send to computer")
                    }
                }
            }
            .buttonStyle(.plain)
            .foregroundStyle(.white)
        } else if context.state.copyReady {
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button(intent: CopyCompletedTranscriptIntent(recordingID: context.attributes.recordingID)) {
                    HStack(spacing: 6) {
                        Image(systemName: "doc.on.doc")
                        Text("Open to copy")
                    }.frame(width: 108, height: 44)
                        .background(.white.opacity(0.14), in: Capsule())
                }.accessibilityLabel("Open Field Theory and copy completed transcript")
                if context.state.sendReady {
                    Button(intent: SendCompletedTranscriptIntent(recordingID: context.attributes.recordingID)) {
                        HStack(spacing: 6) {
                            Image(systemName: "paperplane")
                            Text("Send")
                        }.frame(width: 108, height: 44)
                            .background(.white, in: Capsule()).foregroundStyle(.black)
                    }.accessibilityLabel("Send completed transcript to computer")
                }
            }.font(.caption.weight(.semibold)).buttonStyle(.plain).foregroundStyle(.white)
        }
    }
}
