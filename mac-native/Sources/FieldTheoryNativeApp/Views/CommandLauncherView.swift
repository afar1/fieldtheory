import SwiftUI

struct CommandLauncherView: View {
    @EnvironmentObject private var model: AppModel
    @State private var query: String = ""

    private var filteredCommands: [PortableCommand] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return model.commands }

        return model.commands.filter { command in
            command.name.localizedCaseInsensitiveContains(trimmed)
                || command.displayName.localizedCaseInsensitiveContains(trimmed)
                || command.filePath.localizedCaseInsensitiveContains(trimmed)
        }
    }

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                TextField("Search commands", text: $query)
                    .textFieldStyle(.roundedBorder)
                Button("Refresh") {
                    model.refresh()
                }
            }

            List(filteredCommands) { command in
                VStack(alignment: .leading, spacing: 4) {
                    Text(command.displayName)
                        .font(.headline)
                    Text(command.filePath)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(16)
    }
}
