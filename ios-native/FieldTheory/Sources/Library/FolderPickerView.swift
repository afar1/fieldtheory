import SwiftUI
import UIKit

/// Choose which library folders live on the phone. The index knows about
/// everything in the cloud; only checked folders are materialized.
struct FolderPickerView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private var allFolders: [LibraryFolder] { model.library.folders }

    private func isOn(_ folder: String) -> Bool {
        guard let selected = model.settings.syncedFolders else { return true }
        return selected.contains(folder)
    }

    private func toggle(_ folder: String) {
        var selected = model.settings.syncedFolders ?? allFolders.map(\.name)
        if selected.contains(folder) {
            selected.removeAll { $0 == folder }
        } else {
            selected.append(folder)
        }
        model.settings.syncedFolders = selected
        model.sync.scheduleDebounced(after: 0.8)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(allFolders) { folder in
                        Button {
                            toggle(folder.name)
                        } label: {
                            HStack {
                                Image(systemName: isOn(folder.name) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(isOn(folder.name) ? Color.accentColor : Color.secondary)
                                    .font(.system(size: 20))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(folder.displayName)
                                        .font(.custom("Source Sans 3", size: 17))
                                        .foregroundStyle(.primary)
                                    Text("\(folder.documentCount) documents")
                                        .font(.system(size: 13))
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                            }
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(folder.displayName), \(folder.documentCount) documents")
                        .accessibilityValue(isOn(folder.name) ? "Synced" : "Not synced")
                    }
                } header: {
                    Text(UIDevice.current.userInterfaceIdiom == .pad ? "Folders on this iPad" : "Folders on this phone")
                } footer: {
                    Text("Unchecked folders stay in the cloud and on your Mac — nothing is deleted. Check them anytime to pull them down.")
                }

                if model.settings.syncedFolders != nil {
                    Button("Sync everything") {
                        model.settings.syncedFolders = nil
                        model.sync.scheduleDebounced(after: 0.5)
                    }
                    .accessibilityHint("Downloads every library folder to this device")
                }
            }
            .navigationTitle("Synced Folders")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .keyboardShortcut(.defaultAction)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
