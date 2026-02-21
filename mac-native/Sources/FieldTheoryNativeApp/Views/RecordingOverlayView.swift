import SwiftUI

struct RecordingOverlayView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(model.transcriptionState == .recording ? .red : .gray.opacity(0.6))
                .frame(width: 10, height: 10)
            Text(model.transcriptionState == .recording ? "Recording..." : "Idle")
                .font(.headline)
        }
        .padding(16)
    }
}
