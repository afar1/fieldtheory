import Foundation
import Observation
import Supabase

/// Composition root: owns every store and wires auth state to the sync engine.
@MainActor
@Observable
final class AppModel {
    let settings: AppSettings
    let auth: AuthStore
    let library: LibraryStore
    let river: RiverStore
    let transcripts: TranscriptStore
    let goals: GoalsStore
    let sync: SyncEngine
    let recorder: RecorderController

    private let db: Database

    init() {
        let settings = AppSettings()
        let client = SupabaseConfig.makeClient()
        let supportDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let db = try! Database(path: supportDir.appendingPathComponent("FieldTheory/fieldtheory.sqlite").path)

        let library = LibraryStore(db: db)
        let river = RiverStore(db: db)
        let transcripts = TranscriptStore(db: db)
        let goals = GoalsStore(db: db)
        let auth = AuthStore(client: client)
        let sync = SyncEngine(client: client, db: db, settings: settings,
                              library: library, river: river, transcripts: transcripts)

        self.settings = settings
        self.auth = auth
        self.db = db
        self.library = library
        self.river = river
        self.transcripts = transcripts
        self.goals = goals
        self.sync = sync
        self.recorder = RecorderController()

        auth.onPhaseChange = { [weak self] phase in
            guard let self else { return }
            switch phase {
            case .signedIn(let userId, let email):
                self.sync.start(userId: userId, email: email)
            case .signedOut:
                // Session died (offline, refresh failure, revocation). Stop
                // syncing; local data and identity stay untouched. The only
                // wipe path is the explicit sign-out in Settings.
                self.sync.stop()
            case .loading:
                break
            }
        }

        Task {
            await library.reload()
            await river.reload()
            await transcripts.reload()
            await goals.reload()
            if case .signedIn(let userId, let email) = auth.phase {
                sync.start(userId: userId, email: email)
            }
        }

#if targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("ft-preview") {
            enterPreviewMode()
        }
        // End-to-end whisper validation: the simulator can read host paths,
        // so transcribe a WAV generated on the Mac and print the result.
        if ProcessInfo.processInfo.arguments.contains("ft-test-whisper") {
            Task {
                recorder.models.ensureDownloaded()
                while recorder.models.readyModelURL == nil {
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    if case .failed(let why) = recorder.models.state {
                        print("FT whisper model download failed: \(why)")
                        return
                    }
                }
                do {
                    let text = try await recorder.whisper.transcribe(
                        audioURL: URL(fileURLWithPath: "/tmp/ft-test.wav"),
                        modelURL: recorder.models.readyModelURL!
                    )
                    print("FT whisper result: \(text)")
                } catch {
                    print("FT whisper error: \(error)")
                }
            }
        }
#endif
    }

    func handleDidBecomeActive() {
        if case .signedIn = auth.phase {
            sync.scheduleDebounced(after: 0.3)
        }
        Task { await recorder.resumePendingWork() }
    }

    /// Simulator launch-arg directives for screenshot navigation
    /// ("ft-tab-river", "ft-open-doc", "ft-open-river"); always empty on
    /// device. Plain tokens because simctl swallows --flags.
    var launchDirectives: Set<String> {
#if targetEnvironment(simulator)
        Set(ProcessInfo.processInfo.arguments.filter { $0.hasPrefix("ft-") })
#else
        []
#endif
    }

    /// True when the main tab UI should show: any persisted identity (live
    /// session or not — the app is local-first), or simulator preview.
    var showMainUI: Bool {
        if auth.hasIdentity { return true }
        if case .signedIn = auth.phase { return true }
#if targetEnvironment(simulator)
        return previewMode
#else
        return false
#endif
    }

    /// The explicit sign-out: ends the session, clears identity, wipes the
    /// device copy. The only road back to the login screen.
    func signOutCompletely() async {
        sync.stop()
        await auth.signOut()
        auth.clearIdentity()
        await wipeLocalData()
    }

#if targetEnvironment(simulator)
    /// Simulator-only: seeds fixture data so the UI can be exercised without
    /// an account. Never compiled into device builds.
    var previewMode = false

    func enterPreviewMode() {
        previewMode = true
        Task {
            await PreviewFixtures.seed(library: library, river: river, transcripts: transcripts, db: db)
            await library.reload()
            await river.reload()
            await transcripts.reload()
        }
    }
#endif

    private func wipeLocalData() async {
        try? await db.reset()
        try? FileManager.default.removeItem(at: LibraryStore.libraryRoot)
        await library.reload()
        await river.reload()
        await transcripts.reload()
        await goals.reload()
    }
}
