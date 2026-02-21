import SwiftUI

struct ClipboardHistoryView: View {
    @EnvironmentObject private var model: AppModel

    private let dateFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter
    }()

    var body: some View {
        VStack(spacing: 12) {
            topBar
            safetyBanner
            filterBar
            list
        }
        .padding(16)
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            TextField("Search Fields", text: $model.searchQuery)
                .textFieldStyle(.roundedBorder)

            Button(model.transcriptionState == .recording ? "Stop" : "Record") {
                model.toggleRecording()
            }

            if model.transcriptionState == .recording {
                if model.transcriptionSupportsSnapshots {
                    Button("Snapshot") {
                        model.snapshotRecording()
                    }
                }

                Button("Cancel") {
                    model.cancelRecording()
                }
            }

            Button("Refresh") {
                model.refresh()
            }
        }
    }

    private var filterBar: some View {
        HStack(spacing: 8) {
            filterButton(label: "All", selected: model.selectedTypeFilter == nil) {
                model.selectedTypeFilter = nil
            }

            ForEach(ClipboardItemType.allCases, id: \.self) { itemType in
                filterButton(
                    label: itemType.rawValue.capitalized,
                    selected: model.selectedTypeFilter == itemType
                ) {
                    model.selectedTypeFilter = itemType
                }
            }

            Spacer()
        }
    }

    private func filterButton(label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(label, action: action)
            .buttonStyle(.borderedProminent)
            .tint(selected ? .accentColor : .gray.opacity(0.5))
    }

    private var list: some View {
        List {
            ForEach(model.filteredClipboardItems()) { item in
                HStack(alignment: .top, spacing: 10) {
                    Label(item.type.rawValue.capitalized, systemImage: iconName(for: item.type))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(width: 120, alignment: .leading)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.content ?? "(No text content)")
                            .lineLimit(3)
                            .textSelection(.enabled)
                        Text(dateFormatter.localizedString(for: item.createdAt, relativeTo: Date()))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Button(role: .destructive) {
                        model.deleteItem(id: item.id)
                    } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                    .disabled(model.canDeleteClipboardItems == false)
                }
                .padding(.vertical, 4)
            }
        }
    }

    private var safetyBanner: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: "lock.shield")
                    .foregroundStyle(.orange)
                Text("Strict data safety mode active. Existing local/cloud data is protected.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }

            if let safetyNotice = model.safetyNotice {
                Text(safetyNotice)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func iconName(for type: ClipboardItemType) -> String {
        switch type {
        case .text:
            return "doc.text"
        case .image:
            return "photo"
        case .transcript:
            return "waveform"
        case .screenshot:
            return "camera.viewfinder"
        }
    }
}
