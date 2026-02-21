import AppKit
import SwiftUI

struct MenuBarContentView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Field Theory Native", systemImage: "bolt.fill")
                    .font(.headline)
                Spacer()
                Text(model.transcriptionState.rawValue.capitalized)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Divider()

            Button(model.transcriptionState == .recording ? "Stop Recording" : "Start Recording") {
                model.toggleRecording()
            }
            .keyboardShortcut("r")

            if model.transcriptionState == .recording {
                if model.transcriptionSupportsSnapshots {
                    Button("Snapshot Recording") {
                        model.snapshotRecording()
                    }
                }

                Button("Cancel Recording") {
                    model.cancelRecording()
                }
            }

            Button("Open Clipboard History") {
                model.openClipboardHistoryWindow()
            }
            .keyboardShortcut("h")

            Button("Open Command Launcher") {
                model.openCommandLauncherWindow()
            }
            .keyboardShortcut("k")

            Divider()

            Button("Refresh State") {
                model.refresh()
            }

            Button("Quit Field Theory") {
                NSApplication.shared.terminate(nil)
            }
        }
        .padding(12)
        .frame(width: 260)
    }
}
