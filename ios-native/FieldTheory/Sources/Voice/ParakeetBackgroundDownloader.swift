import Foundation

extension Notification.Name {
    static let parakeetBackgroundDownloadChanged = Notification.Name(
        "com.afar1.fieldtheory.parakeet-background-download-changed")
}

struct ParakeetBackgroundDownloadSnapshot: Equatable, Sendable {
    enum Phase: Equatable, Sendable {
        case idle
        case downloading
        case verifying
        case ready
        case failed(String)
    }

    let modelDirectory: URL
    let phase: Phase
    let progress: Double
}

/// Owns the app's one durable background URL session. Existing system tasks are
/// reattached after relaunch, but this object never creates a request unless
/// `start` is called from the user's explicit Download or Retry action.
final class ParakeetBackgroundDownloader: NSObject, URLSessionDownloadDelegate,
    @unchecked Sendable
{
    static let shared = ParakeetBackgroundDownloader()
    static let sessionIdentifier = "com.afar1.fieldtheory.parakeet-model-download"
    static let intentName = ".fieldtheory-background-download.json"
    static let stagingDirectoryName = ".fieldtheory-background-staging"

    private struct Intent: Codable {
        let identity: String
        let revision: String
        let createdAtMs: Int64
    }

    private let lock = NSLock()
    private let configuredSessionIdentifier: String
    private var currentDirectory = ParakeetModelManager.defaultModelDirectory
    private var currentAssets = PinnedParakeetAssets.v2English
    private var phase = ParakeetBackgroundDownloadSnapshot.Phase.idle
    private var verifiedBytes: Int64 = 0
    private var receivedBytes: [String: Int64] = [:]
    private var isStarting = false
    private var isFinalizing = false
    private var backgroundEventsAwaitingCompletion = false
    private var backgroundCompletionHandler: (() -> Void)?

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(
            withIdentifier: configuredSessionIdentifier)
        configuration.sessionSendsLaunchEvents = true
        configuration.isDiscretionary = false
        configuration.waitsForConnectivity = true
        configuration.allowsCellularAccess = true
        configuration.timeoutIntervalForRequest = 300
        configuration.timeoutIntervalForResource = 86_400
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    init(sessionIdentifier: String = ParakeetBackgroundDownloader.sessionIdentifier) {
        configuredSessionIdentifier = sessionIdentifier
        super.init()
    }

    func hasPersistedIntent(in directory: URL) -> Bool {
        FileManager.default.fileExists(atPath: intentURL(in: directory).path)
    }

    func snapshot(for directory: URL) -> ParakeetBackgroundDownloadSnapshot {
        lock.lock()
        defer { lock.unlock() }
        let standardized = directory.standardizedFileURL
        guard standardized == currentDirectory.standardizedFileURL else {
            return .init(modelDirectory: standardized, phase: .idle, progress: 0)
        }
        return makeSnapshotLocked()
    }

    /// Reconnects delegate delivery and existing OS-owned tasks only. If no
    /// persisted explicit-download intent exists, this performs no network work.
    func reconnect(
        modelDirectory: URL = ParakeetModelManager.defaultModelDirectory,
        assets: [PinnedParakeetAsset] = PinnedParakeetAssets.v2English
    ) {
        guard hasPersistedIntent(in: modelDirectory) else { return }
        lock.lock()
        currentDirectory = modelDirectory.standardizedFileURL
        currentAssets = assets
        phase = .downloading
        lock.unlock()
        publish()
        reconcileExistingTasks()
    }

    /// Enqueues every missing asset immediately so the system process owns the
    /// complete transfer set before this method returns.
    func start(modelDirectory: URL, assets: [PinnedParakeetAsset]) async throws {
        guard claimStart(modelDirectory: modelDirectory, assets: assets) else { return }
        do {
            try FileManager.default.createDirectory(
                at: modelDirectory, withIntermediateDirectories: true)
            try ModelFileIntegrity.excludeFromBackup(modelDirectory)
            try writeIntent(in: modelDirectory)

            let existingTasks = await session.allTasks
            let existingPaths = Set(existingTasks.compactMap(\.taskDescription))
            let plan = await Self.assetsNeedingNewTasks(
                assets, in: modelDirectory, activePaths: existingPaths)
            let validBytes = assets
                .filter { !plan.invalidPaths.contains($0.path) }
                .reduce(Int64(0)) { $0 + $1.byteCount }
            var newTasks: [URLSessionDownloadTask] = []

            for asset in plan.assetsToSchedule {
                let request = try Self.request(for: asset)
                let task = session.downloadTask(with: request)
                task.taskDescription = asset.path
                task.countOfBytesClientExpectsToReceive = asset.byteCount
                newTasks.append(task)
            }

            finishStart(verifiedBytes: validBytes)
            publish()

            // Resume only after the durable intent and complete task set exist.
            existingTasks.forEach { $0.resume() }
            newTasks.forEach { $0.resume() }
            if existingTasks.isEmpty && newTasks.isEmpty {
                reconcileExistingTasks()
            }
        } catch {
            abandonStart()
            setFailure(error)
            throw error
        }
    }

    func handleEvents(
        for identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        guard identifier == configuredSessionIdentifier else {
            completionHandler()
            return
        }
        lock.lock()
        backgroundCompletionHandler = completionHandler
        lock.unlock()
        _ = session
        if hasPersistedIntent(in: ParakeetModelManager.defaultModelDirectory) {
            reconnect()
        } else {
            reconcileExistingTasks()
        }
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        guard let path = downloadTask.taskDescription else { return }
        lock.lock()
        receivedBytes[path] = max(0, totalBytesWritten)
        lock.unlock()
        publish()
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        do {
            guard let response = downloadTask.response as? HTTPURLResponse,
                  (200...299).contains(response.statusCode),
                  let path = downloadTask.taskDescription,
                  let asset = asset(for: path)
            else { throw ParakeetModelError.badResponse }
            let directory = modelDirectory()
            let staged = try Self.stageDownloadedAsset(asset, from: location, in: directory)
            do {
                try Self.promoteStagedAsset(asset, in: directory)
            } catch {
                // A completed checksum failure is retryable. If iOS stops the
                // process during hashing, this line is never reached and the
                // app-owned staged file remains for relaunch recovery.
                try? FileManager.default.removeItem(at: staged)
                throw error
            }
            lock.lock()
            verifiedBytes += asset.byteCount
            receivedBytes[path] = nil
            lock.unlock()
        } catch {
            setFailure(error)
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        if let error { setFailure(error) }
        reconcileExistingTasks()
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        lock.lock()
        backgroundEventsAwaitingCompletion = true
        lock.unlock()
        reconcileExistingTasks()
    }

    static func installDownloadedAsset(
        _ asset: PinnedParakeetAsset,
        from temporaryURL: URL,
        to destination: URL
    ) throws {
        // The temporary URL is valid only during the delegate callback. Verify
        // it before any existing local asset is touched.
        try PinnedParakeetAssets.validate(asset, at: temporaryURL)
        let fileManager = FileManager.default
        try fileManager.createDirectory(
            at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        let staging = destination.deletingLastPathComponent()
            .appendingPathComponent(".\(destination.lastPathComponent).incoming-\(UUID().uuidString)")
        try fileManager.moveItem(at: temporaryURL, to: staging)
        do {
            if fileManager.fileExists(atPath: destination.path) {
                _ = try fileManager.replaceItemAt(destination, withItemAt: staging)
            } else {
                try fileManager.moveItem(at: staging, to: destination)
            }
        } catch {
            try? fileManager.removeItem(at: staging)
            throw error
        }
    }

    /// Moves the system-owned temporary file into app-owned storage before
    /// expensive checksum work. The returned file survives suspension/relaunch.
    @discardableResult
    static func stageDownloadedAsset(
        _ asset: PinnedParakeetAsset,
        from temporaryURL: URL,
        in directory: URL
    ) throws -> URL {
        let fileManager = FileManager.default
        let staged = stagedURL(for: asset, in: directory)
        try fileManager.createDirectory(
            at: staged.deletingLastPathComponent(), withIntermediateDirectories: true)
        let incoming = staged.deletingLastPathComponent().appendingPathComponent(
            ".\(staged.lastPathComponent).received-\(UUID().uuidString)")
        try fileManager.moveItem(at: temporaryURL, to: incoming)
        do {
            if fileManager.fileExists(atPath: staged.path) {
                _ = try fileManager.replaceItemAt(staged, withItemAt: incoming)
            } else {
                try fileManager.moveItem(at: incoming, to: staged)
            }
            return staged
        } catch {
            try? fileManager.removeItem(at: incoming)
            throw error
        }
    }

    static func promoteStagedAsset(
        _ asset: PinnedParakeetAsset,
        in directory: URL
    ) throws {
        let staged = stagedURL(for: asset, in: directory)
        guard FileManager.default.fileExists(atPath: staged.path) else { return }
        try installDownloadedAsset(
            asset, from: staged, to: directory.appendingPathComponent(asset.path))
    }

    private func reconcileExistingTasks() {
        session.getAllTasks { [weak self] tasks in
            guard let self else { return }
            if !tasks.isEmpty {
                self.lock.lock()
                for task in tasks {
                    if let path = task.taskDescription {
                        self.receivedBytes[path] = max(0, task.countOfBytesReceived)
                    }
                }
                if case .failed = self.phase {
                    // Preserve a concrete task error until explicit Retry.
                } else {
                    self.phase = .downloading
                }
                self.lock.unlock()
                self.publish()
                self.finishBackgroundEventsIfSafe()
                return
            }
            self.finalizeIfComplete()
        }
    }

    private func finalizeIfComplete() {
        let directory = modelDirectory()
        guard hasPersistedIntent(in: directory) else {
            finishBackgroundEventsIfSafe()
            return
        }
        lock.lock()
        guard !isStarting else {
            lock.unlock()
            return
        }
        if case .failed = phase {
            lock.unlock()
            publish()
            finishBackgroundEventsIfSafe()
            return
        }
        guard !isFinalizing else {
            lock.unlock()
            return
        }
        isFinalizing = true
        let assets = currentAssets
        phase = .verifying
        lock.unlock()
        publish()

        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            do {
                try Self.finalizeDownloadedModel(in: directory, assets: assets)
                self.completeFinalization(totalBytes: assets.reduce(Int64(0)) { $0 + $1.byteCount })
                self.publish()
                self.finishBackgroundEventsIfSafe()
            } catch {
                self.endFinalization()
                self.setFailure(error)
                self.finishBackgroundEventsIfSafe()
            }
        }
    }

    private func setFailure(_ error: Error) {
        let message: String
        if let localized = error as? LocalizedError,
           let description = localized.errorDescription {
            message = description
        } else {
            message = "Parakeet download failed. Retry to continue. \(error.localizedDescription)"
        }
        lock.lock()
        phase = .failed(message)
        lock.unlock()
        publish()
    }

    private func publish() {
        let snapshot = snapshot(for: modelDirectory())
        NotificationCenter.default.post(
            name: .parakeetBackgroundDownloadChanged,
            object: self,
            userInfo: ["snapshot": snapshot])
    }

    private func finishBackgroundEventsIfSafe() {
        lock.lock()
        guard backgroundEventsAwaitingCompletion, !isStarting, !isFinalizing else {
            lock.unlock()
            return
        }
        backgroundEventsAwaitingCompletion = false
        let completionHandler = backgroundCompletionHandler
        backgroundCompletionHandler = nil
        lock.unlock()
        guard let completionHandler else { return }
        DispatchQueue.main.async(execute: completionHandler)
    }

    private func makeSnapshotLocked() -> ParakeetBackgroundDownloadSnapshot {
        let total = max(1, currentAssets.reduce(Int64(0)) { $0 + $1.byteCount })
        let received = receivedBytes.reduce(Int64(0)) { partial, entry in
            let expected = currentAssets.first(where: { $0.path == entry.key })?.byteCount ?? 0
            return partial + min(expected, entry.value)
        }
        return .init(
            modelDirectory: currentDirectory,
            phase: phase,
            progress: min(1, Double(verifiedBytes + received) / Double(total)))
    }

    struct AssetPlan: Sendable {
        let invalidPaths: Set<String>
        let assetsToSchedule: [PinnedParakeetAsset]
    }

    static func assetsNeedingNewTasks(
        _ assets: [PinnedParakeetAsset],
        in directory: URL,
        activePaths: Set<String>
    ) async -> AssetPlan {
        await Task.detached(priority: .utility) {
            var invalidPaths = Set<String>()
            var assetsToSchedule: [PinnedParakeetAsset] = []
            for asset in assets {
                let destination = directory.appendingPathComponent(asset.path)
                let staged = stagedURL(for: asset, in: directory)
                let hasValidDestination =
                    (try? PinnedParakeetAssets.validate(asset, at: destination)) != nil
                let hasValidStagedDownload =
                    (try? PinnedParakeetAssets.validate(asset, at: staged)) != nil
                guard hasValidDestination || hasValidStagedDownload else {
                    invalidPaths.insert(asset.path)
                    if !activePaths.contains(asset.path) { assetsToSchedule.append(asset) }
                    continue
                }
            }
            return AssetPlan(invalidPaths: invalidPaths, assetsToSchedule: assetsToSchedule)
        }.value
    }

    static func finalizeDownloadedModel(
        in directory: URL, assets: [PinnedParakeetAsset]
    ) throws {
        // The durable intent remains if validation fails, so a relaunch exposes
        // Retry instead of publishing a partial cache as ready.
        try recoverStagedAssets(in: directory, assets: assets)
        try PinnedParakeetAssets.validateAll(in: directory, assets: assets)
        try PinnedParakeetAssets.writeReceipt(to: directory)
        let intent = directory.appendingPathComponent(intentName)
        if FileManager.default.fileExists(atPath: intent.path) {
            try FileManager.default.removeItem(at: intent)
        }
    }

    private static func recoverStagedAssets(
        in directory: URL, assets: [PinnedParakeetAsset]
    ) throws {
        for asset in assets {
            let staged = stagedURL(for: asset, in: directory)
            guard FileManager.default.fileExists(atPath: staged.path) else { continue }
            do {
                try promoteStagedAsset(asset, in: directory)
            } catch {
                try? FileManager.default.removeItem(at: staged)
                throw error
            }
        }
    }

    private static func stagedURL(
        for asset: PinnedParakeetAsset, in directory: URL
    ) -> URL {
        directory.appendingPathComponent(stagingDirectoryName, isDirectory: true)
            .appendingPathComponent(asset.path)
    }

    private func claimStart(modelDirectory: URL, assets: [PinnedParakeetAsset]) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !isStarting else { return false }
        isStarting = true
        currentDirectory = modelDirectory.standardizedFileURL
        currentAssets = assets
        phase = .downloading
        receivedBytes = [:]
        return true
    }

    private func finishStart(verifiedBytes: Int64) {
        lock.lock()
        self.verifiedBytes = verifiedBytes
        isStarting = false
        lock.unlock()
    }

    private func abandonStart() {
        lock.lock()
        isStarting = false
        lock.unlock()
    }

    private func completeFinalization(totalBytes: Int64) {
        lock.lock()
        verifiedBytes = totalBytes
        receivedBytes = [:]
        phase = .ready
        isFinalizing = false
        lock.unlock()
    }

    private func endFinalization() {
        lock.lock()
        isFinalizing = false
        lock.unlock()
    }

    private func modelDirectory() -> URL {
        lock.lock()
        defer { lock.unlock() }
        return currentDirectory
    }

    private func asset(for path: String) -> PinnedParakeetAsset? {
        lock.lock()
        defer { lock.unlock() }
        return currentAssets.first(where: { $0.path == path })
    }

    private func writeIntent(in directory: URL) throws {
        let intent = Intent(
            identity: ParakeetModelManager.identity,
            revision: PinnedParakeetAssets.revision,
            createdAtMs: Int64(Date().timeIntervalSince1970 * 1_000))
        try JSONEncoder().encode(intent).write(to: intentURL(in: directory), options: .atomic)
    }

    private func intentURL(in directory: URL) -> URL {
        directory.appendingPathComponent(Self.intentName)
    }

    private static func request(for asset: PinnedParakeetAsset) throws -> URLRequest {
        let encodedPath = asset.path.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed) ?? asset.path
        guard let url = URL(string:
            "https://huggingface.co/\(PinnedParakeetAssets.repository)/resolve/\(PinnedParakeetAssets.revision)/\(encodedPath)?download=true")
        else { throw ParakeetModelError.invalidSourceURL(asset.path) }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return request
    }
}
