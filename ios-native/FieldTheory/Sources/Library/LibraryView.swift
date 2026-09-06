import SwiftUI

private enum LibraryCollection: Hashable {
    case recents
    case folder(String)
}

struct LibraryView: View {
    @Binding var showSettings: Bool
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var showFolderPicker = false
    @State private var newDoc: LibraryDocMeta?
    @State private var openedDoc: LibraryDocMeta?
    @State private var searchText = ""

    @State private var splitVisibility: NavigationSplitViewVisibility = .all
    @State private var selectedCollection: LibraryCollection? = .recents
    @State private var selectedDocument: LibraryDocMeta?
    @State private var focusDocumentID: String?
    @State private var handledLaunchDirective = false

    private var visibleFolders: [LibraryFolder] {
        model.library.folders.filter { folder in
            guard let selected = model.settings.syncedFolders else { return true }
            return selected.contains(folder.name)
        }
    }

    private var recentDocs: [LibraryDocMeta] {
        model.library.recents
    }

    private var searchResults: [LibraryDocMeta] {
        guard !searchText.isEmpty else { return [] }
        return model.library.allDocs.filter {
            $0.materialized && $0.title.localizedCaseInsensitiveContains(searchText)
        }
    }

    private var selectedDocuments: [LibraryDocMeta] {
        if !searchText.isEmpty { return searchResults }
        switch selectedCollection {
        case .some(.recents), .none:
            return recentDocs
        case .some(.folder(let folder)):
            return (model.library.docsByFolder[folder] ?? []).filter(\.materialized)
        }
    }

    private var selectedCollectionTitle: String {
        if !searchText.isEmpty { return "Search" }
        switch selectedCollection {
        case .some(.recents), .none: return "Recent"
        case .some(.folder(let folder)): return folder.isEmpty ? "Library" : folder
        }
    }

    private var newDocumentFolder: String {
        guard case .some(.folder(let folder)) = selectedCollection, searchText.isEmpty else {
            return model.settings.newDocFolder
        }
        return folder
    }

    var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                regularLibrary
            } else {
                compactLibrary
            }
        }
        .task { await handleLaunchDirective() }
        .onChange(of: model.library.allDocs) { _, documents in
            guard let selectedDocument else { return }
            self.selectedDocument = documents.first { $0.clientId == selectedDocument.clientId }
        }
        .onChange(of: visibleFolders.map(\.name)) { _, folderNames in
            guard case .some(.folder(let folder)) = selectedCollection,
                  !folderNames.contains(folder) else { return }
            selectedCollection = .recents
        }
        .onChange(of: horizontalSizeClass) { _, sizeClass in
            if sizeClass == .regular, let openedDoc {
                selectInRegularLayout(openedDoc)
            } else if sizeClass == .compact, let selectedDocument {
                openedDoc = selectedDocument
            }
        }
    }

    private var compactLibrary: some View {
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
                                FolderRow(folder: folder)
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
                    Button { createCompactDocument() } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .accessibilityLabel("New document")
                    .keyboardShortcut("n", modifiers: .command)
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { showFolderPicker = true } label: {
                        Image(systemName: "line.3.horizontal.decrease.circle")
                    }
                    .accessibilityLabel("Choose synced folders")
                    Button { showSettings = true } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Settings")
                    .keyboardShortcut(",", modifiers: .command)
                }
            }
            .navigationDestination(for: LibraryFolder.self) { folder in
                FolderContentsView(folder: folder)
                    .onAppear { selectedCollection = .folder(folder.name) }
            }
            .navigationDestination(for: LibraryDocMeta.self) { doc in
                DocumentView(doc: doc)
                    .onAppear { selectedDocument = doc }
            }
            .navigationDestination(item: $newDoc) { doc in
                DocumentView(doc: doc, startEditing: true)
                    .onAppear { selectedDocument = doc }
            }
            .navigationDestination(item: $openedDoc) { doc in
                DocumentView(doc: doc, startEditing: model.launchDirectives.contains("ft-edit-doc"))
                    .onAppear { selectedDocument = doc }
            }
            .sheet(isPresented: $showFolderPicker) {
                FolderPickerView()
            }
        }
    }

    private var regularLibrary: some View {
        NavigationSplitView(columnVisibility: $splitVisibility) {
            List(selection: $selectedCollection) {
                Section {
                    HStack(spacing: 12) {
                        Image(systemName: "clock")
                            .foregroundStyle(Theme.accent(model.settings.accentPreset, colorScheme))
                            .font(.system(size: 16))
                        Text("Recent")
                            .font(.custom("Source Sans 3", size: 17))
                        Spacer()
                        Text("\(recentDocs.count)")
                            .font(.system(size: 14, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                    .tag(LibraryCollection.recents)
                }

                Section("Folders") {
                    ForEach(visibleFolders) { folder in
                        FolderRow(folder: folder)
                            .tag(LibraryCollection.folder(folder.name))
                    }
                    if model.library.folders.isEmpty {
                        emptyState
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("Library")
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .automatic))
            .refreshable { await model.sync.syncNow() }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { showFolderPicker = true } label: {
                        Image(systemName: "line.3.horizontal.decrease.circle")
                    }
                    .accessibilityLabel("Choose synced folders")
                    .popover(isPresented: $showFolderPicker, arrowEdge: .top) {
                        FolderPickerView()
                            .frame(minWidth: 420, idealWidth: 460, minHeight: 480, idealHeight: 560)
                            .presentationCompactAdaptation(.sheet)
                    }

                    Button { showSettings = true } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Settings")
                    .keyboardShortcut(",", modifiers: .command)
                }
            }
            .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 320)
        } content: {
            Group {
                if selectedDocuments.isEmpty {
                    documentListEmptyState
                } else {
                    List(selection: $selectedDocument) {
                        ForEach(selectedDocuments) { doc in
                            DocRow(doc: doc)
                                .tag(doc)
                        }
                        .onDelete(perform: deleteDocuments)
                    }
                    .listStyle(.plain)
                    .refreshable { await model.sync.syncNow() }
                }
            }
            .navigationTitle(selectedCollectionTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { createRegularDocument() } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .accessibilityLabel("New document")
                    .keyboardShortcut("n", modifiers: .command)
                }
            }
            .navigationSplitViewColumnWidth(min: 260, ideal: 330, max: 420)
        } detail: {
            if let selectedDocument {
                DocumentView(
                    doc: selectedDocument,
                    startEditing: focusDocumentID == selectedDocument.clientId,
                    onDelete: { self.selectedDocument = nil }
                )
                .id(selectedDocument.clientId)
                .task(id: selectedDocument.clientId) {
                    guard focusDocumentID == selectedDocument.clientId else { return }
                    try? await Task.sleep(nanoseconds: 400_000_000)
                    if focusDocumentID == selectedDocument.clientId {
                        focusDocumentID = nil
                    }
                }
            } else {
                ContentUnavailableView(
                    "No Document Selected",
                    systemImage: "doc.text",
                    description: Text("Choose a document from the library.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.background(colorScheme))
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    @ViewBuilder
    private var documentListEmptyState: some View {
        if !searchText.isEmpty {
            ContentUnavailableView.search(text: searchText)
        } else {
            ContentUnavailableView(
                "No Documents",
                systemImage: "doc.text",
                description: Text("Documents in this location will appear here.")
            )
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

    private func createCompactDocument() {
        Task {
            newDoc = await model.library.createDocument(
                in: model.settings.newDocFolder,
                title: LibraryStore.defaultTitle()
            )
        }
    }

    private func createRegularDocument() {
        Task {
            guard let document = await model.library.createDocument(
                in: newDocumentFolder,
                title: LibraryStore.defaultTitle()
            ) else { return }
            focusDocumentID = document.clientId
            selectInRegularLayout(document)
        }
    }

    private func selectInRegularLayout(_ document: LibraryDocMeta) {
        selectedCollection = .folder(document.folder)
        selectedDocument = document
    }

    private func deleteDocuments(at offsets: IndexSet) {
        let documents = offsets.map { selectedDocuments[$0] }
        Task {
            for document in documents {
                if selectedDocument?.clientId == document.clientId {
                    selectedDocument = nil
                }
                await model.library.deleteDocument(document)
            }
        }
    }

    private func handleLaunchDirective() async {
        guard !handledLaunchDirective,
              model.launchDirectives.contains("ft-open-doc") || model.launchDirectives.contains("ft-edit-doc") else { return }
        handledLaunchDirective = true
        try? await Task.sleep(nanoseconds: 600_000_000)
        guard let document = model.library.allDocs.first(where: { $0.sourcePath.hasPrefix("scratchpad/Reading") }) else { return }
        if model.launchDirectives.contains("ft-edit-doc") {
            focusDocumentID = document.clientId
        }
        if horizontalSizeClass == .regular {
            selectInRegularLayout(document)
        } else {
            openedDoc = document
        }
    }
}

private struct FolderRow: View {
    let folder: LibraryFolder
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
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
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(folder.displayName), \(folder.documentCount) documents")
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
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(doc.title), updated \(max(doc.localUpdatedAtMs, doc.remoteUpdatedAtMs).msToDate.relativeShort)")
    }
}

struct FolderContentsView: View {
    let folder: LibraryFolder
    @Environment(AppModel.self) private var model
    @Environment(ReadingState.self) private var readingState

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
        // Pushed view: leave the leading edge to the system back-swipe.
        .onAppear { readingState.enter() }
        .onDisappear { readingState.exit() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task {
                        _ = await model.library.createDocument(in: folder.name, title: LibraryStore.defaultTitle())
                    }
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel("New document in \(folder.displayName)")
                .keyboardShortcut("n", modifiers: .command)
            }
        }
    }
}
