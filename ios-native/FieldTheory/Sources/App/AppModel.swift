import Foundation
import Observation
import UIKit
import Supabase

/// Composition root: owns every store and wires auth state to the sync engine.
@MainActor
@Observable
final class AppModel {
    static let shared = AppModel()
    let settings: AppSettings
    let auth: AuthStore
    private(set) var library: LibraryStore
    private(set) var river: RiverStore
    private(set) var transcripts: TranscriptStore
    private(set) var sync: SyncEngine
    private(set) var recorder: RecorderController {
        didSet { wireRecorderPersistence() }
    }

    private(set) var isSigningOut = false
    private(set) var isPreparingStorage = true
    private(set) var isReviewerDemoStorage = false
    private(set) var storageAccessBlocked = false
    private(set) var workspaceGeneration = UUID()
    var storageAlert: StorageAlert?

    private var db: Database
    private var productionStack: StorageStack
    private let productionRecorder: RecorderController
    private let productionDatabasePath: String
    private let productionLibraryRoot: URL
    private let reviewerDemoDatabasePath: String
    private let reviewerDemoRoot: URL
    private var productionStorageAvailable: Bool
    private var authTransitionTask: Task<Void, Never>?
    private var transitionGeneration: UInt64 = 0
    private var explicitWorkspaceTransition = false
    private var pendingAuthPhase: AuthPhase?

    struct StorageAlert: Identifiable {
        let id = UUID()
        let message: String
    }

    typealias ReviewerDemoSeed = @MainActor (
        _ library: LibraryStore,
        _ river: RiverStore,
        _ transcripts: TranscriptStore,
        _ database: Database
    ) async throws -> Void

    private struct StorageStack {
        let db: Database
        let library: LibraryStore
        let river: RiverStore
        let transcripts: TranscriptStore
        let sync: SyncEngine
    }

    init(
        databasePathOverride: String? = nil,
        libraryRootOverride: URL? = nil,
        reviewerDemoDatabasePathOverride: String? = nil,
        reviewerDemoRootOverride: URL? = nil,
        recorderOverride: RecorderController? = nil,
        startInitialPreparation: Bool = true
    ) {
        let settings = AppSettings()
        let client = SupabaseConfig.makeClient()
        let supportDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let databasePath = databasePathOverride
            ?? supportDir.appendingPathComponent("FieldTheory/fieldtheory.sqlite").path
        let opened = Database.recovering(path: databasePath)
        let db = opened.database

        let library = LibraryStore(db: db, libraryRoot: libraryRootOverride)
        let river = RiverStore(db: db)
        let transcripts = TranscriptStore(db: db, usesCountdown: false)
        let auth = AuthStore(client: client)
        let sync = SyncEngine(client: client, db: db, settings: settings,
                              library: library, river: river, transcripts: transcripts)

        self.settings = settings
        self.auth = auth
        self.productionDatabasePath = databasePath
        self.productionLibraryRoot = libraryRootOverride ?? LibraryStore.libraryRoot
        self.reviewerDemoDatabasePath = reviewerDemoDatabasePathOverride
            ?? supportDir.appendingPathComponent("FieldTheory/reviewer-demo.sqlite").path
        self.reviewerDemoRoot = reviewerDemoRootOverride
            ?? Self.documentsRoot.appendingPathComponent("reviewer-demo", isDirectory: true)
        self.productionStorageAvailable = opened.error == nil
        self.db = db
        self.library = library
        self.river = river
        self.transcripts = transcripts
        self.sync = sync
        self.productionStack = StorageStack(
            db: db, library: library, river: river,
            transcripts: transcripts, sync: sync
        )
        let recorder = recorderOverride ?? Self.makeRecorder()
        self.recorder = recorder
        self.productionRecorder = recorder
        recorder.replaceWords = { [weak sync] text in sync?.wordSubstitutions.apply(to: text) ?? text }
        recorder.setWorkEnabled(auth.hasIdentity && opened.error == nil)
        wireStorageErrors()
        if let error = opened.error {
            storageAccessBlocked = true
            storageAlert = StorageAlert(message: "Local storage could not be opened. Your existing files were left unchanged. Try again after checking available storage. (\(error.localizedDescription))")
        }

        auth.onPhaseChange = { [weak self] phase in
            guard let self else { return }
            self.scheduleAuthTransition(phase)
        }

        if startInitialPreparation {
            Task {
                await prepareProductionStorage(
                    userId: auth.userId,
                    liveSession: auth.phase,
                    transition: 0
                )
            }
        } else {
            isPreparingStorage = false
        }

#if targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("ft-preview") {
            enterPreviewMode()
        }
#endif
    }

    func startRecordingIfEnabledOnOpen() async {
        guard settings.startRecordingOnOpen else { return }
        for _ in 0..<200 {
            if !isPreparingStorage { break }
            try? await Task.sleep(for: .milliseconds(50))
            guard !Task.isCancelled else { return }
        }
        guard UIApplication.shared.applicationState == .active,
              settings.startRecordingOnOpen, showMainUI, !isSigningOut,
              !isReviewerDemoStorage, recorder.phase == .idle,
              recorder.pendingSessionCount == 0 else { return }
        recorder.start()
    }

    func handleDidBecomeActive() {
        guard !isPreparingStorage, !storageAccessBlocked else { return }
        if case .signedIn = auth.phase {
            sync.scheduleDebounced(after: 0.3)
        }
        Task {
            await transcripts.reload()
            await recorder.resumePendingWork()
        }
    }

    /// Retained only so the dormant Library/River source continues to compile.
    /// Voice-only navigation deliberately exposes no simulator route directives.
    var launchDirectives: Set<String> { [] }

    /// True when the main tab UI should show: any persisted identity (live
    /// session or not — the app is local-first), or simulator preview.
    var showMainUI: Bool {
        guard !isPreparingStorage, !storageAccessBlocked else { return false }
        if isReviewerDemoStorage { return true }
        if auth.hasIdentity { return true }
        if case .signedIn = auth.phase { return true }
#if targetEnvironment(simulator)
        return previewMode
#else
        return false
#endif
    }

    /// Reviewer Demo can retain an underlying production session for the
    /// return path, but it must never submit demo fixture reports remotely.
    var canSubmitRiverReports: Bool {
        auth.sessionAlive
            && !isReviewerDemoStorage
            && !isPreparingStorage
            && !storageAccessBlocked
            && !isSigningOut
    }

    /// A report captures this generation before its network request. Any
    /// workspace switch (including Reviewer Demo) invalidates later UI state.
    func acceptsRiverReportResult(workspace: UUID, reporterID: UUID) -> Bool {
        canSubmitRiverReports
            && workspaceGeneration == workspace
            && auth.userId == reporterID
    }

    /// The explicit sign-out: ends the session, clears identity, wipes the
    /// device copy. The only road back to the login screen.
    func signOutCompletely() async {
        if isReviewerDemoStorage {
            await exitReviewerDemo()
            return
        }
        guard !isSigningOut else { return }
        isSigningOut = true
        defer { isSigningOut = false }
        await beginExplicitWorkspaceTransition()
#if targetEnvironment(simulator)
        previewMode = false
#endif
        await sync.stopAndWait()
        sync.wordSubstitutions.selectUser(nil)
        auth.clearIdentity()
        do {
            try await recorder.discardRecordings()
        } catch {
            auth.lastError = "Could not remove saved recordings. Recording stays disabled until cleanup succeeds."
        }
        await auth.signOut()
        // A token-refresh event may have repersisted identity while cleanup awaited.
        sync.wordSubstitutions.selectUser(nil)
        auth.clearIdentity()
        await wipeLocalData()
        recorder.setWorkEnabled(false)
        finishExplicitWorkspaceTransition(resumeLatestAuth: false)
    }

    /// Activates a physically separate database and document root for App
    /// Review. The production sync is fully settled before fixtures can run.
    /// Demo mode never starts a Supabase sync or consumes pending recordings.
    func enterReviewerDemo(seed: ReviewerDemoSeed) async throws {
        guard !isReviewerDemoStorage else { return }
        isPreparingStorage = true
        await beginExplicitWorkspaceTransition()
        await sync.stopAndWait()
        await recorder.suspendAndWait()

        let opened = Database.recovering(path: reviewerDemoDatabasePath)
        let demoRoot = reviewerDemoRoot.appendingPathComponent("library", isDirectory: true)
        let demoAudioRoot = reviewerDemoRoot.appendingPathComponent("pending-audio", isDirectory: true)
        let demoStack = makeStack(db: opened.database, libraryRoot: demoRoot)

        do {
            if let error = opened.error { throw error }
            guard let demoDefaults = UserDefaults(suiteName: "com.afar1.fieldtheory.reviewer-demo") else {
                throw DatabaseError(message: "Reviewer Demo preferences are unavailable")
            }
            demoDefaults.removePersistentDomain(forName: "com.afar1.fieldtheory.reviewer-demo")
            try await demoStack.db.reset()
            if FileManager.default.fileExists(atPath: demoRoot.path) {
                try FileManager.default.removeItem(at: demoRoot)
            }
            if FileManager.default.fileExists(atPath: demoAudioRoot.path) {
                try FileManager.default.removeItem(at: demoAudioRoot)
            }
            activate(demoStack)
            try await seed(library, river, transcripts, db)
            await reloadActiveStores()
            recorder = Self.makeRecorder(
                pendingDirectory: demoAudioRoot,
                metricsDirectory: reviewerDemoRoot.appendingPathComponent("VoiceDiagnostics", isDirectory: true),
                defaults: demoDefaults
            )
            isReviewerDemoStorage = true
            auth.beginReviewerDemo()
            storageAccessBlocked = false
            recorder.setWorkEnabled(true)
            workspaceGeneration = UUID()
            isPreparingStorage = false
            finishExplicitWorkspaceTransition(resumeLatestAuth: false)
        } catch {
            activate(productionStack)
            recorder = productionRecorder
            recorder.setWorkEnabled(auth.hasIdentity && productionStorageAvailable)
            isReviewerDemoStorage = false
            isPreparingStorage = false
            finishExplicitWorkspaceTransition(resumeLatestAuth: true)
            throw error
        }
    }

    /// Reopens the durable production database after a launch/storage error.
    /// The temporary fallback is never allowed to sync or accept edits.
    func retryStoragePreparation() async {
        guard !isReviewerDemoStorage else { return }
        await beginExplicitWorkspaceTransition()
        isPreparingStorage = true
        storageAccessBlocked = true
        await sync.stopAndWait()

        let opened = Database.recovering(path: productionDatabasePath)
        if let error = opened.error {
            isPreparingStorage = false
            presentStorageError("Local storage is still unavailable. Check device storage and try again, or relaunch Field Theory. (\(error.localizedDescription))")
            finishExplicitWorkspaceTransition(resumeLatestAuth: true)
            return
        }

        let reopened = makeStack(db: opened.database, libraryRoot: productionLibraryRoot)
        productionStack = reopened
        productionStorageAvailable = true
        activate(reopened)
        workspaceGeneration = UUID()
        storageAccessBlocked = false
        await prepareProductionStorage(userId: auth.userId, liveSession: auth.phase)
        finishExplicitWorkspaceTransition(resumeLatestAuth: true)
    }

    /// Removes only Reviewer Demo fixtures, then restores the retained
    /// production stack. No production table or document path is touched.
    func exitReviewerDemo() async {
        guard isReviewerDemoStorage else { return }
        await beginExplicitWorkspaceTransition()
        isPreparingStorage = true
        await sync.stopAndWait()
        let demoDB = db
        let demoRoot = library.libraryRoot
        do {
            try await recorder.discardRecordings()
            try await demoDB.reset()
            if FileManager.default.fileExists(atPath: demoRoot.path) {
                try FileManager.default.removeItem(at: demoRoot)
            }
        } catch {
            presentStorageError("Reviewer Demo data could not be fully removed. Production data was left unchanged. (\(error.localizedDescription))")
        }

        activate(productionStack)
        recorder = productionRecorder
        isReviewerDemoStorage = false
        auth.endReviewerDemo()
#if targetEnvironment(simulator)
        previewMode = false
#endif
        workspaceGeneration = UUID()
        await prepareProductionStorage(userId: auth.userId, liveSession: auth.phase)
        finishExplicitWorkspaceTransition(resumeLatestAuth: true)
    }

#if targetEnvironment(simulator)
    /// Simulator-only: seeds fixture data so the UI can be exercised without
    /// an account. Never compiled into device builds.
    var previewMode = false

    func enterPreviewMode() {
        previewMode = true
        Task {
            do {
                try await enterReviewerDemo { _, _, transcripts, db in
                    await PreviewFixtures.seed(transcripts: transcripts, db: db)
                }
            } catch {
                previewMode = false
                presentStorageError("Preview storage could not be prepared. Production data was left unchanged. (\(error.localizedDescription))")
            }
        }
    }
#endif

    private func wipeLocalData() async {
        if !isReviewerDemoStorage, !productionStorageAvailable {
            // The durable index could not be opened, so deleting the document
            // root would destroy files we cannot safely reconcile.
            presentStorageError("You were signed out, but local files were retained because storage is unavailable. Relaunch Field Theory before signing in to another account.")
            return
        }
        do {
            if FileManager.default.fileExists(atPath: library.libraryRoot.path) {
                try FileManager.default.removeItem(at: library.libraryRoot)
            }
            // Keep the old owner marker until external files are gone. If
            // cleanup fails, the next different account must still take the
            // owner-switch path instead of adopting an unclaimed replica.
            try await db.reset()
        } catch {
            presentStorageError("Local account data could not be fully removed. It will remain isolated from the next account. (\(error.localizedDescription))")
        }
        await reloadActiveStores()
    }

    private static var documentsRoot: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    /// Production and reviewer recorders share one local runtime so a workspace
    /// transition cannot launch a second non-cooperative Core ML load.
    private static let sharedParakeetService = ParakeetService()

    private static func makeRecorder(
        pendingDirectory: URL = RecorderController.pendingAudioDir,
        metricsDirectory: URL = RecorderController.voiceDiagnosticsDir,
        defaults: UserDefaults = .standard
    ) -> RecorderController {
        RecorderController(
            pendingDirectory: pendingDirectory,
            metricsDirectory: metricsDirectory,
            defaults: defaults,
            speechEngine: ParakeetSpeechTranscriptionEngine(
                models: ParakeetModelManager(),
                service: sharedParakeetService
            )
        )
    }

    private func makeStack(db: Database, libraryRoot: URL) -> StorageStack {
        let library = LibraryStore(db: db, libraryRoot: libraryRoot)
        let river = RiverStore(db: db)
        let transcripts = TranscriptStore(db: db, usesCountdown: false)
        let sync = SyncEngine(
            client: auth.client, db: db, settings: settings,
            library: library, river: river, transcripts: transcripts
        )
        return StorageStack(db: db, library: library, river: river, transcripts: transcripts, sync: sync)
    }

    private func activate(_ stack: StorageStack) {
        db = stack.db
        library = stack.library
        river = stack.river
        transcripts = stack.transcripts
        sync = stack.sync
        wireStorageErrors()
    }

    /// Persistence must be available even when an intent starts the process without a scene.
    func wireRecorderPersistence() {
        let recorder = recorder
        recorder.replaceWords = { [weak self] text in self?.sync.wordSubstitutions.apply(to: text) ?? text }
        recorder.onCaptureStarted = { [weak self] in
            guard let self, self === AppModel.shared else { return }
            BackgroundRecordingSession.shared.attachToForegroundRecording()
        }
        recorder.onTranscript = { [weak self, weak recorder] text in
            guard let self, let recorder, self.recorder === recorder,
                  self.showMainUI, !self.isSigningOut else { return false }
            let workspace = self.workspaceGeneration
            let userID = self.auth.userId
            let finishAction = recorder.finishAction(for: recorder.currentDeliverySessionID)
            let shouldSend = finishAction.map { $0 == .send }
                ?? self.settings.shouldAutoSend(sessionID: recorder.currentDeliverySessionID)
            guard let item = await self.transcripts.add(text: text, autoSend: shouldSend) else { return false }
            recorder.associateCurrentDelivery(transcriptID: item.id)
            guard self.workspaceGeneration == workspace, !self.isSigningOut,
                  self.auth.userId == userID else { return false }
            if self.settings.autoCopyTranscripts, UIApplication.shared.applicationState == .active {
                UIPasteboard.general.setItems([["public.utf8-plain-text": text]], options: [.localOnly: true])
            }
            // Keep the transcription's execution allowance until the upload attempt settles.
            // The durable dirty row remains retryable on network/auth failure.
            if !self.isReviewerDemoStorage { await self.sync.syncNow() }
            recorder.onNotice?("Saved to Field Theory", "waveform")
            return true
        }
    }

    private func wireStorageErrors() {
        wireRecorderPersistence()
        library.onStorageError = { [weak self] message in self?.presentStorageError(message) }
        transcripts.onStorageError = { [weak self] message in self?.presentStorageError(message) }
    }

    private func presentStorageError(_ message: String) {
        storageAlert = StorageAlert(message: message)
    }

    private func reloadActiveStores() async {
        await library.reload()
        await river.reload()
        await transcripts.reload()
    }

    private func scheduleAuthTransition(_ phase: AuthPhase) {
        if explicitWorkspaceTransition {
            pendingAuthPhase = phase
            return
        }
        startAuthTransition(phase)
    }

    private func startAuthTransition(_ phase: AuthPhase) {
        pendingAuthPhase = nil
        transitionGeneration &+= 1
        let transition = transitionGeneration
        authTransitionTask?.cancel()
        authTransitionTask = Task { [weak self] in
            guard let self else { return }
            await self.applyAuthPhase(phase, transition: transition)
        }
    }

    private func applyAuthPhase(_ phase: AuthPhase, transition: UInt64) async {
        guard transition == transitionGeneration,
              !explicitWorkspaceTransition,
              !isSigningOut,
              !isReviewerDemoStorage else { return }
        switch phase {
        case .signedIn(let userId, let email):
            await prepareProductionStorage(
                userId: userId,
                liveSession: .signedIn(userId: userId, email: email),
                transition: transition
            )
        case .signedOut:
            // Session loss keeps the current account's local-first replica,
            // but no in-flight request may continue under stale credentials.
            await sync.stopAndWait()
            guard transition == transitionGeneration else { return }
            recorder.setWorkEnabled(auth.hasIdentity)
            isPreparingStorage = false
        case .loading:
            break
        }
    }

    private func prepareProductionStorage(
        userId: UUID?,
        liveSession: AuthPhase,
        transition: UInt64? = nil
    ) async {
        guard transitionIsCurrent(transition) else { return }
        isPreparingStorage = true
        guard !isReviewerDemoStorage else {
            isPreparingStorage = false
            return
        }
        await sync.stopAndWait()
        guard transitionIsCurrent(transition) else { return }
        await recorder.suspendAndWait()
        guard transitionIsCurrent(transition) else { return }
        guard productionStorageAvailable else {
            storageAccessBlocked = true
            recorder.setWorkEnabled(false)
            isPreparingStorage = false
            return
        }

        sync.wordSubstitutions.selectUser(userId?.uuidString.lowercased())
        if let userId {
            let ownerID = userId.uuidString.lowercased()
            var databaseActivated = false
            do {
                let changedAccount = try await db.activate(ownerID: ownerID)
                databaseActivated = true
                guard transitionIsCurrent(transition) else { return }
                let cleanupRequired = try await db.externalCleanupRequired()
                if cleanupRequired {
                    // The old recorder callback is already settled. Remove its
                    // queued audio before enabling the new account, then reset
                    // every workspace-local navigation/editor closure.
                    try await recorder.discardRecordings()
                    if FileManager.default.fileExists(atPath: library.libraryRoot.path) {
                        try FileManager.default.removeItem(at: library.libraryRoot)
                    }
                    try await db.markExternalCleanupComplete()
                }
                if changedAccount {
                    workspaceGeneration = UUID()
                }
            } catch {
                presentStorageError("This account's local storage could not be prepared. Existing files were left unchanged and sync remains paused. (\(error.localizedDescription))")
                if !databaseActivated { productionStorageAvailable = false }
                storageAccessBlocked = true
                recorder.setWorkEnabled(false)
                isPreparingStorage = false
                return
            }
        }

        await reloadActiveStores()
        guard transitionIsCurrent(transition) else { return }
        storageAccessBlocked = false
        recorder.setWorkEnabled(userId != nil)
        if case .signedIn(let liveUserId, let email) = liveSession,
           liveUserId == userId {
            await sync.start(userId: liveUserId, email: email)
        }
        isPreparingStorage = false
    }

    private func transitionIsCurrent(_ transition: UInt64?) -> Bool {
        guard !Task.isCancelled else { return false }
        guard let transition else { return true }
        return transition == transitionGeneration
    }

    private func beginExplicitWorkspaceTransition() async {
        explicitWorkspaceTransition = true
        transitionGeneration &+= 1
        let previous = authTransitionTask
        authTransitionTask = nil
        previous?.cancel()
        await previous?.value
    }

    private func finishExplicitWorkspaceTransition(resumeLatestAuth: Bool) {
        explicitWorkspaceTransition = false
        let phase = pendingAuthPhase
        pendingAuthPhase = nil
        if resumeLatestAuth, let phase {
            startAuthTransition(phase)
        }
    }
}
