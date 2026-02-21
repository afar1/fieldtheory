import SwiftUI

struct SettingsRootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        TabView {
            generalTab
                .tabItem {
                    Label("General", systemImage: "gearshape")
                }

            transcriptionTab
                .tabItem {
                    Label("Transcription", systemImage: "waveform")
                }

            hotkeysTab
                .tabItem {
                    Label("Hotkeys", systemImage: "keyboard")
                }

            syncTab
                .tabItem {
                    Label("Sync", systemImage: "arrow.triangle.2.circlepath")
                }
        }
        .padding(16)
        .frame(width: 760, height: 520)
    }

    private var generalTab: some View {
        Form {
            Toggle("Show In Dock", isOn: $model.showInDock)
            Toggle("Launch At Login", isOn: $model.launchAtLogin)

            HStack {
                Text("Accessibility")
                Spacer()
                permissionBadge(model.permissions.accessibility ? "Granted" : "Missing", good: model.permissions.accessibility)
            }

            HStack {
                Text("Screen Recording")
                Spacer()
                permissionBadge(model.permissions.screenRecording ? "Granted" : "Missing", good: model.permissions.screenRecording)
            }

            HStack {
                Text("Microphone")
                Spacer()
                permissionBadge(model.permissions.microphone.rawValue.capitalized, good: model.permissions.microphone == .granted)
            }

            HStack {
                Button("Request Microphone Access") {
                    model.requestMicrophonePermission()
                }

                Button("Refresh Permissions") {
                    model.refresh()
                }
            }
        }
    }

    private var transcriptionTab: some View {
        Form {
            Picker("Engine", selection: Binding(
                get: { model.transcriptionEngine },
                set: { model.setTranscriptionEngine($0) }
            )) {
                ForEach(TranscriptionEngineKind.allCases) { engine in
                    Text(engine.displayName).tag(engine)
                }
            }

            HStack {
                Text("Available Engines")
                Spacer()
                if model.availableTranscriptionEngines.isEmpty {
                    Text("None")
                        .foregroundStyle(.orange)
                } else {
                    Text(model.availableTranscriptionEngines.map(\.displayName).joined(separator: ", "))
                        .foregroundStyle(.secondary)
                }
            }

            HStack {
                Text("Recording Backend")
                Spacer()
                Text(model.transcriptionRecordingBackend == .helper ? "FieldTheoryHelper" : "AVAudioRecorder")
                    .foregroundStyle(.secondary)
            }

            HStack {
                Text("Snapshot Support")
                Spacer()
                Text(model.transcriptionSupportsSnapshots ? "Enabled" : "Unavailable")
                    .foregroundStyle(model.transcriptionSupportsSnapshots ? .green : .secondary)
            }

            HStack {
                Text("Current State")
                Spacer()
                Text(model.transcriptionState.rawValue.capitalized)
                    .foregroundStyle(.secondary)
            }

            HStack {
                Button(model.transcriptionState == .recording ? "Stop Recording" : "Start Recording") {
                    model.toggleRecording()
                }

                if model.transcriptionState == .recording, model.transcriptionSupportsSnapshots {
                    Button("Snapshot") {
                        model.snapshotRecording()
                    }
                }

                if model.transcriptionState == .recording {
                    Button("Cancel") {
                        model.cancelRecording()
                    }
                }
            }

            if let transcriptionError = model.transcriptionError, transcriptionError.isEmpty == false {
                Text(transcriptionError)
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            Section("Engine Diagnostics") {
                if model.transcriptionEngineDiagnostics.isEmpty {
                    Text("No diagnostics available yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.transcriptionEngineDiagnostics) { diagnostic in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(diagnostic.engine.displayName)
                                Spacer()
                                Text(diagnostic.available ? "Ready" : "Unavailable")
                                    .foregroundStyle(diagnostic.available ? .green : .orange)
                            }
                            Text(diagnostic.message)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            let inputDevices = model.audioInputs()
            Section("Input Devices") {
                if inputDevices.isEmpty {
                    Text("CoreAudio device enumeration not wired yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(inputDevices, id: \.id) { device in
                        Text(device.name)
                    }
                }
            }
        }
    }

    private var hotkeysTab: some View {
        Form {
            hotkeyRow(
                "Transcription",
                text: Binding(
                    get: { model.hotkeys.transcription },
                    set: { next in
                        var config = model.hotkeys
                        config.transcription = next
                        model.updateHotkeys(config)
                    }
                )
            )

            hotkeyRow(
                "Screenshot",
                text: Binding(
                    get: { model.hotkeys.screenshot },
                    set: { next in
                        var config = model.hotkeys
                        config.screenshot = next
                        model.updateHotkeys(config)
                    }
                )
            )

            hotkeyRow(
                "History",
                text: Binding(
                    get: { model.hotkeys.clipboardHistory },
                    set: { next in
                        var config = model.hotkeys
                        config.clipboardHistory = next
                        model.updateHotkeys(config)
                    }
                )
            )

            hotkeyRow(
                "Command Launcher",
                text: Binding(
                    get: { model.hotkeys.commandLauncher },
                    set: { next in
                        var config = model.hotkeys
                        config.commandLauncher = next
                        model.updateHotkeys(config)
                    }
                )
            )
        }
    }

    private var syncTab: some View {
        Form {
            HStack {
                Text("Safety Policy")
                Spacer()
                Text("STRICT")
                    .foregroundStyle(.orange)
            }

            HStack {
                Text("Cloud Writes")
                Spacer()
                Text(model.cloudWritesEnabled ? "Enabled" : "Blocked")
                    .foregroundStyle(model.cloudWritesEnabled ? .green : .orange)
            }

            HStack {
                Text("Session")
                Spacer()
                Text(model.syncStatus.isSignedIn ? "Signed In" : "Signed Out")
                    .foregroundStyle(model.syncStatus.isSignedIn ? .green : .secondary)
            }

            HStack {
                Text("Status")
                Spacer()
                Text(model.syncStatus.statusLine)
                    .foregroundStyle(.secondary)
            }

            Text(model.safetyModeDescription)
                .font(.caption2)
                .foregroundStyle(.secondary)

            Text(model.safetyAuditSummary)
                .font(.caption2)
                .foregroundStyle(.secondary)

            HStack {
                Text("Last Sync")
                Spacer()
                if let lastSyncDate = model.syncStatus.lastSyncDate {
                    Text(lastSyncDate.formatted(date: .abbreviated, time: .shortened))
                        .foregroundStyle(.secondary)
                } else {
                    Text("Never")
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func hotkeyRow(_ title: String, text: Binding<String>) -> some View {
        HStack {
            Text(title)
            Spacer()
            TextField("Shortcut", text: text)
                .frame(width: 220)
                .multilineTextAlignment(.trailing)
        }
    }

    private func permissionBadge(_ text: String, good: Bool) -> some View {
        Text(text)
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(good ? Color.green.opacity(0.15) : Color.red.opacity(0.15))
            .clipShape(Capsule())
    }
}
