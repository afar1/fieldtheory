import SwiftUI

struct LibraryView: View {
    @Binding var showSettings: Bool
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme

    @State private var showFolderPicker = false
    @State private var newDoc: LibraryDocMeta?
    @State private var openedDoc: LibraryDocMeta?
    @State private var searchText = ""

    private var visibleFolders: [LibraryFolder] {
        model.library.folders.filter { folder in
            guard let selected = model.settings.syncedFolders else { return true }
            return selected.contains(folder.name)
        }
    }

    private var recentDocs: [LibraryDocMeta] {
        Array(model.library.allDocs.filter(\.materialized).prefix(5))
    }

    private var searchResults: [LibraryDocMeta] {
        guard !searchText.isEmpty else { return [] }
        return model.library.allDocs.filter {
            $0.materialized && $0.title.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if !searchText.isEmpty {
                    ForEach(searchResults) { doc in
                        NavigationLink(value: doc) { DocRow(doc: doc) }
                    }
                } else {
                    if !recentDocs.isEmpty {
                        Section("Recent") {
                            ForEach(recentDocs) { doc in
                                NavigationLink(value: doc) { DocRow(doc: doc) }
                            }
                        }
                    }
                    Section("Folders") {
                        ForEach(visibleFolders) { folder in
                            NavigationLink(value: folder) {
                                HStack(spacing: 12) {
                                    Image(systemName: "folder")
                                        .foregroundStyle(Theme.accent(model.settings.accentPreset, colorScheme))
                                        .font(.system(size: 16))
                                    Text(folder.displayName)
                                        .font(.custom("Source Sans 3", size: 17))
                                    Spacer()
                                    Text("\(folder.documentCount)")
                                        .font(.system(size: 14, design: .monospaced))
                                        .foregroundStyle(.tertiary)
                                }
                            }
                        }
                        if model.library.folders.isEmpty {
                            emptyState
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Library")
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .automatic))
            .refreshable { await model.sync.syncNow() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        Task {
                            newDoc = await model.library.createDocument(
                                in: model.settings.newDocFolder,
                                title: LibraryStore.defaultTitle()
                            )
                        }
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { showFolderPicker = true } label: {
                        Image(systemName: "line.3.horizontal.decrease.circle")
                    }
                    Button { showSettings = true } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .navigationDestination(for: LibraryFolder.self) { folder in
                FolderContentsView(folder: folder)
            }
            .navigationDestination(for: LibraryDocMeta.self) { doc in
                DocumentView(doc: doc)
            }
            .navigationDestination(item: $newDoc) { doc in
                DocumentView(doc: doc, startEditing: true)
            }
            .navigationDestination(item: $openedDoc) { doc in
                DocumentView(doc: doc, startEditing: model.launchDirectives.contains("ft-edit-doc"))
            }
            .sheet(isPresented: $showFolderPicker) {
                FolderPickerView()
            }
            .task {
                if model.launchDirectives.contains("ft-open-doc") || model.launchDirectives.contains("ft-edit-doc") {
                    try? await Task.sleep(nanoseconds: 600_000_000)
                    openedDoc = model.library.allDocs.first { $0.sourcePath.hasPrefix("scratchpad/Reading") }
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(model.sync.status == .syncing ? "Syncing your library…" : "Nothing here yet")
                .font(.custom("Source Sans 3", size: 16).weight(.medium))
            Text("Your Mac's library appears here after the first sync.")
                .font(.custom("Source Sans 3", size: 14))
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
    }
}

struct DocRow: View {
    let doc: LibraryDocMeta

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(doc.title)
                .font(.custom("Source Sans 3", size: 17))
                .lineLimit(1)
            Text(max(doc.localUpdatedAtMs, doc.remoteUpdatedAtMs).msToDate.relativeShort)
                .font(.system(size: 13))
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
    }
}

struct FolderContentsView: View {
    let folder: LibraryFolder
    @Environment(AppModel.self) private var model

    private var docs: [LibraryDocMeta] {
        (model.library.docsByFolder[folder.name] ?? []).filter(\.materialized)
    }

    var body: some View {
        List {
            ForEach(docs) { doc in
                NavigationLink(value: doc) { DocRow(doc: doc) }
            }
            .onDelete { offsets in
                let toDelete = offsets.map { docs[$0] }
                Task {
                    for doc in toDelete { await model.library.deleteDocument(doc) }
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle(folder.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task {
                        _ = await model.library.createDocument(in: folder.name, title: LibraryStore.defaultTitle())
                    }
                } label: {
                    Image(systemName: "square.and.pencil")
                }
            }
        }
    }
}
