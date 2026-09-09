import CryptoKit
import Foundation
import Observation

enum ParakeetModelState: Equatable {
    case notDownloaded
    case checking
    case downloading(progress: Double)
    case preparing
    case ready
    case failed(String)
}

/// Owns the optional Parakeet model assets. Merely constructing this object never
/// starts a network request. Only `download()`/`retryDownload()` can do that.
@MainActor
@Observable
final class ParakeetModelManager {
    nonisolated static let identity = "fluidaudio.parakeet-tdt-0.6b-v2.en@ee09c569"
    nonisolated static let displayName = "Parakeet TDT v2 (English)"
    nonisolated static let approximateDownloadSize = "About 500 MB"

    private(set) var state: ParakeetModelState = .notDownloaded
    var onReady: (() -> Void)?

    private let storedModelDirectory: URL
    private let assets: [PinnedParakeetAsset]
    private let downloadAsset: PinnedParakeetAssetDownloader
    private let backgroundDownloader: ParakeetBackgroundDownloader?
    @ObservationIgnored nonisolated(unsafe) private var backgroundObserver: NSObjectProtocol?
    private var operationTask: Task<Void, Never>?

    var modelDirectory: URL { storedModelDirectory }

    var readyModelURL: URL? {
        guard case .ready = state else { return nil }
        guard PinnedParakeetAssets.haveExpectedSizes(in: storedModelDirectory, assets: assets) else {
            state = .failed("The saved Parakeet model is incomplete. Retry the download.")
            return nil
        }
        return storedModelDirectory
    }

    var readyModelDirectory: URL? { readyModelURL }

    init(
        modelDirectory: URL? = nil,
        assets: [PinnedParakeetAsset] = PinnedParakeetAssets.v2English,
        downloadAsset: PinnedParakeetAssetDownloader? = nil
    ) {
        storedModelDirectory = modelDirectory ?? Self.defaultModelDirectory
        self.assets = assets
        self.downloadAsset = downloadAsset ?? PinnedParakeetAssets.downloader
        backgroundDownloader = downloadAsset == nil ? .shared : nil

        if let backgroundDownloader {
            backgroundObserver = NotificationCenter.default.addObserver(
                forName: .parakeetBackgroundDownloadChanged,
                object: backgroundDownloader,
                queue: .main
            ) { [weak self, weak backgroundDownloader] notification in
                guard let snapshot = notification.userInfo?["snapshot"]
                    as? ParakeetBackgroundDownloadSnapshot
                else { return }
                Task { @MainActor [weak self, weak backgroundDownloader] in
                    guard let self, backgroundDownloader != nil else { return }
                    self.apply(snapshot)
                }
            }
            if backgroundDownloader.hasPersistedIntent(in: storedModelDirectory) {
                apply(backgroundDownloader.snapshot(for: storedModelDirectory))
                backgroundDownloader.reconnect(
                    modelDirectory: storedModelDirectory, assets: assets)
            } else if PinnedParakeetAssets.hasPotentialCache(
                in: storedModelDirectory, assets: assets) {
                beginCachedReadinessCheck()
            }
        } else if PinnedParakeetAssets.hasPotentialCache(
            in: storedModelDirectory, assets: assets) {
            beginCachedReadinessCheck()
        }
    }

    deinit {
        if let backgroundObserver {
            NotificationCenter.default.removeObserver(backgroundObserver)
        }
    }

    nonisolated static var defaultModelDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FieldTheory/Models/parakeet-tdt-v2-ee09c569", isDirectory: true)
    }

    /// Revalidates a copied or previously downloaded cache without accessing the network.
    func checkCachedReadiness() async {
        if let operationTask { await operationTask.value; return }
        if let backgroundDownloader,
           backgroundDownloader.hasPersistedIntent(in: storedModelDirectory) {
            apply(backgroundDownloader.snapshot(for: storedModelDirectory))
            backgroundDownloader.reconnect(
                modelDirectory: storedModelDirectory, assets: assets)
            return
        }
        beginCachedReadinessCheck()
        await operationTask?.value
    }

    func checkLocalReadiness() async { await checkCachedReadiness() }

    func download() {
        guard operationTask == nil else { return }
        switch state {
        case .ready, .checking, .downloading, .preparing:
            return
        case .notDownloaded, .failed:
            beginDownload()
        }
    }

    func retryDownload() { download() }

    func waitForCurrentOperation() async { await operationTask?.value }

    private func beginCachedReadinessCheck() {
        guard operationTask == nil else { return }
        state = .checking
        operationTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await Self.validateOffMain(
                    directory: storedModelDirectory,
                    assets: assets,
                    progress: nil
                )
                try PinnedParakeetAssets.writeReceipt(to: storedModelDirectory)
                state = .ready
                onReady?()
            } catch {
                state = .failed(Self.displayError(error))
            }
            operationTask = nil
        }
    }

    private func beginDownload() {
        if let backgroundDownloader {
            state = .downloading(progress: 0)
            operationTask = Task { [weak self] in
                guard let self else { return }
                do {
                    try await backgroundDownloader.start(
                        modelDirectory: storedModelDirectory, assets: assets)
                    apply(backgroundDownloader.snapshot(for: storedModelDirectory))
                } catch {
                    state = .failed(Self.displayError(error))
                }
                operationTask = nil
            }
            return
        }

        state = .downloading(progress: 0)
        operationTask = Task { [weak self] in
            guard let self else { return }
            do {
                try FileManager.default.createDirectory(
                    at: storedModelDirectory, withIntermediateDirectories: true)
                try ModelFileIntegrity.excludeFromBackup(storedModelDirectory)

                let totalBytes = max(1, assets.reduce(Int64(0)) { $0 + $1.byteCount })
                var completedBytes: Int64 = 0
                for asset in assets {
                    try Task.checkCancellation()
                    let destination = storedModelDirectory.appendingPathComponent(asset.path)
                    let alreadyValid = await Task.detached(priority: .utility) {
                        (try? PinnedParakeetAssets.validate(asset, at: destination)) != nil
                    }.value
                    if !alreadyValid {
                        let baseCompletedBytes = completedBytes
                        try await downloadAsset(asset, destination) { [weak self] bytes in
                            let fraction = min(1, Double(baseCompletedBytes + bytes) / Double(totalBytes))
                            Task { @MainActor [weak self] in
                                guard let self, case .downloading = self.state else { return }
                                self.state = .downloading(progress: fraction)
                            }
                        }
                    }
                    completedBytes += asset.byteCount
                    state = .downloading(progress: min(1, Double(completedBytes) / Double(totalBytes)))
                }

                state = .preparing
                try await Self.validateOffMain(
                    directory: storedModelDirectory,
                    assets: assets,
                    progress: nil
                )
                try PinnedParakeetAssets.writeReceipt(to: storedModelDirectory)
                state = .ready
                onReady?()
            } catch is CancellationError {
                state = .failed("Parakeet download was interrupted. Retry to continue.")
            } catch {
                state = .failed(Self.displayError(error))
            }
            operationTask = nil
        }
    }

    private static func validateOffMain(
        directory: URL,
        assets: [PinnedParakeetAsset],
        progress: (@Sendable (Double) -> Void)?
    ) async throws {
        try await Task.detached(priority: .utility) {
            try PinnedParakeetAssets.validateAll(in: directory, assets: assets, progress: progress)
        }.value
    }

    private static func displayError(_ error: Error) -> String {
        if let localized = error as? LocalizedError, let description = localized.errorDescription {
            return description
        }
        return "Parakeet could not be prepared. Retry the download. \(error.localizedDescription)"
    }

    private func apply(_ snapshot: ParakeetBackgroundDownloadSnapshot) {
        guard snapshot.modelDirectory.standardizedFileURL
                == storedModelDirectory.standardizedFileURL else { return }
        let wasReady: Bool
        if case .ready = state { wasReady = true } else { wasReady = false }
        switch snapshot.phase {
        case .idle:
            if !PinnedParakeetAssets.hasPotentialCache(
                in: storedModelDirectory, assets: assets) {
                state = .notDownloaded
            }
        case .downloading:
            state = .downloading(progress: snapshot.progress)
        case .verifying:
            state = .preparing
        case .ready:
            guard PinnedParakeetAssets.haveExpectedSizes(
                in: storedModelDirectory, assets: assets) else {
                state = .failed("The saved Parakeet model is incomplete. Retry the download.")
                return
            }
            state = .ready
            if !wasReady { onReady?() }
        case .failed(let message):
            state = .failed(message)
        }
    }
}

struct PinnedParakeetAsset: Sendable {
    let path: String
    let byteCount: Int64
    let sha256: String
}

typealias PinnedParakeetAssetDownloader = @Sendable (
    _ asset: PinnedParakeetAsset,
    _ destination: URL,
    _ progress: @escaping @Sendable (Int64) -> Void
) async throws -> Void

enum PinnedParakeetAssets {
    static let repository = "FluidInference/parakeet-tdt-0.6b-v2-coreml"
    static let revision = "ee09c569f73759e6d44c9bd16766f477b2b36d39"
    static let receiptName = ".fieldtheory-model.json"
    static let downloader: PinnedParakeetAssetDownloader = { asset, destination, progress in
        try await download(asset, destination, progress)
    }

    static let v2English: [PinnedParakeetAsset] = [
        .init(path: "Decoder.mlmodelc/analytics/coremldata.bin", byteCount: 243, sha256: "46de1a6fe2e49d19a2125bc91acf020df7f2aea84ba821532aade8427a440b05"),
        .init(path: "Decoder.mlmodelc/coremldata.bin", byteCount: 554, sha256: "d200ca07694a347f6d02a3886a062ae839831e094e443222f2e48a14945966a8"),
        .init(path: "Decoder.mlmodelc/metadata.json", byteCount: 3_427, sha256: "90a279b822496316458febc0ce761ab05954fadd9d66aa97bea077a35fc8f2b2"),
        .init(path: "Decoder.mlmodelc/model.mil", byteCount: 13_106, sha256: "7b95a5a6b672c652000348a67b6d4d92bb8e176b978c6666fe73c28a4d7ec579"),
        .init(path: "Decoder.mlmodelc/weights/weight.bin", byteCount: 14_429_952, sha256: "27d26890221d82322c1092fd99d7b40578e435d5cf4b83c887c42603caf97aba"),
        .init(path: "Encoder.mlmodelc/analytics/coremldata.bin", byteCount: 243, sha256: "42e638870d73f26b332918a3496ce36793fbb413a81cbd3d16ba01328637a105"),
        .init(path: "Encoder.mlmodelc/coremldata.bin", byteCount: 485, sha256: "4def7aa848599ad0e17a8b9a982edcdbf33cf92e1f4b798de32e2ca0bc74b030"),
        .init(path: "Encoder.mlmodelc/metadata.json", byteCount: 2_926, sha256: "58222fbc48c13c49d9715567803cd50cb9c23e4360462e0f8ffcea59a2c73c63"),
        .init(path: "Encoder.mlmodelc/model.mil", byteCount: 959_769, sha256: "ed7b19156ca29fa7dfd6891deb9fda4b0e8893f68597c985d135736546a43808"),
        .init(path: "Encoder.mlmodelc/weights/weight.bin", byteCount: 445_187_200, sha256: "4adc7ad44f9d05e1bffeb2b06d3bb02861a5c7602dff63a6b494aed3bf8a6c3e"),
        .init(path: "JointDecision.mlmodelc/analytics/coremldata.bin", byteCount: 243, sha256: "f1183ba213bb94a918c8d2cad19ab045320618f97f6ca662245b3936d7b090f7"),
        .init(path: "JointDecision.mlmodelc/coremldata.bin", byteCount: 534, sha256: "e2c6752f1c8cf2d3f6f26ec93195c9bfa759ad59edf9f806696a138154f96f11"),
        .init(path: "JointDecision.mlmodelc/metadata.json", byteCount: 2_936, sha256: "ba8d309417b9acd4a175fdb15687de6a941db2f5b06666a60e7cf3cc8e2d3c3c"),
        .init(path: "JointDecision.mlmodelc/model.mil", byteCount: 9_722, sha256: "93bf82042235127cb81ab537dcae47a1c2e7e242ce4ffdaf772981b45eedc4f0"),
        .init(path: "JointDecision.mlmodelc/weights/weight.bin", byteCount: 3_453_388, sha256: "ca22a65903a05e64137677da608077578a8606090a598abf4875fa6199aaa19d"),
        .init(path: "Preprocessor.mlmodelc/analytics/coremldata.bin", byteCount: 243, sha256: "03ab3c1327a054c54c07a40325db967ec574f2c91dcc8192bfa44aa561bcf2d8"),
        .init(path: "Preprocessor.mlmodelc/coremldata.bin", byteCount: 494, sha256: "d88ea1fc349459c9e100d6a96688c5b29a1f0d865f544be103001724b986b6d6"),
        .init(path: "Preprocessor.mlmodelc/metadata.json", byteCount: 2_974, sha256: "fb16c581ff5e1b962e7cb2181ed892cd32f9f84c12b6e80ff3e089f28e35bcbb"),
        .init(path: "Preprocessor.mlmodelc/model.mil", byteCount: 27_166, sha256: "3e06d16fd061294c8a75be68c43a3b1ed1f593d4a9c35249e9cdbccadc59721e"),
        .init(path: "Preprocessor.mlmodelc/weights/weight.bin", byteCount: 298_880, sha256: "a5f7df6c7f47147ae9486fe18cc7792f9a44d093ec3c6a11e91ef2dc363c48dc"),
        .init(path: "parakeet_vocab.json", byteCount: 18_762, sha256: "57019fe3c745772ca83a1b048a4bb951cd51329504ea33d4d83316b96e279a97"),
    ]

    static func hasPotentialCache(in directory: URL, assets: [PinnedParakeetAsset]) -> Bool {
        FileManager.default.fileExists(atPath: directory.appendingPathComponent(receiptName).path)
            || assets.contains { FileManager.default.fileExists(atPath: directory.appendingPathComponent($0.path).path) }
    }

    static func haveExpectedSizes(in directory: URL, assets: [PinnedParakeetAsset]) -> Bool {
        assets.allSatisfy { asset in
            let url = directory.appendingPathComponent(asset.path)
            guard let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
                  Int64(values.fileSize ?? -1) == asset.byteCount else { return false }
            return true
        }
    }

    static func validateAll(
        in directory: URL,
        assets: [PinnedParakeetAsset],
        progress: (@Sendable (Double) -> Void)? = nil
    ) throws {
        let total = max(1, assets.reduce(Int64(0)) { $0 + $1.byteCount })
        var completed: Int64 = 0
        for asset in assets {
            try Task.checkCancellation()
            try validate(asset, at: directory.appendingPathComponent(asset.path))
            completed += asset.byteCount
            progress?(Double(completed) / Double(total))
        }
        try validateVocabulary(at: directory.appendingPathComponent("parakeet_vocab.json"))
        try ModelFileIntegrity.excludeFromBackup(directory)
    }

    static func validate(_ asset: PinnedParakeetAsset, at url: URL) throws {
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw ParakeetModelError.missingAsset(asset.path)
        }
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        let size = (attributes[.size] as? NSNumber)?.int64Value ?? -1
        guard size == asset.byteCount else { throw ParakeetModelError.invalidAsset(asset.path) }
        guard try sha256(of: url) == asset.sha256 else {
            throw ParakeetModelError.invalidAsset(asset.path)
        }
    }

    static func validateVocabulary(at url: URL) throws {
        let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
        guard let vocabulary = object as? [String: String], !vocabulary.isEmpty else {
            throw ParakeetModelError.invalidAsset(url.lastPathComponent)
        }
    }

    static func writeReceipt(to directory: URL) throws {
        let receipt: [String: Any] = [
            "identity": ParakeetModelManager.identity,
            "repository": repository,
            "revision": revision,
            "fluidAudio": "0.15.6",
        ]
        let data = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
        try data.write(to: directory.appendingPathComponent(receiptName), options: [.atomic])
        try ModelFileIntegrity.excludeFromBackup(directory)
    }

    static func download(
        _ asset: PinnedParakeetAsset,
        _ destination: URL,
        _ progress: @escaping @Sendable (Int64) -> Void
    ) async throws {
        let encodedPath = asset.path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? asset.path
        guard let url = URL(string: "https://huggingface.co/\(repository)/resolve/\(revision)/\(encodedPath)?download=true") else {
            throw ParakeetModelError.invalidSourceURL(asset.path)
        }
        let transfer = PinnedFileTransfer(source: url, asset: asset, destination: destination, progress: progress)
        try await withTaskCancellationHandler {
            try await transfer.start()
        } onCancel: {
            transfer.cancel()
        }
    }

    private static func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty {
            try Task.checkCancellation()
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

enum ParakeetModelError: LocalizedError {
    case missingAsset(String)
    case invalidAsset(String)
    case invalidSourceURL(String)
    case badResponse

    var errorDescription: String? {
        switch self {
        case .missingAsset:
            return "Parakeet is not fully downloaded. Retry the download."
        case .invalidAsset:
            return "The saved Parakeet model could not be verified. Retry the download."
        case .invalidSourceURL:
            return "The pinned Parakeet download source is invalid."
        case .badResponse:
            return "The Parakeet download server returned an unexpected response. Retry later."
        }
    }
}

private final class PinnedFileTransfer: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let source: URL
    private let asset: PinnedParakeetAsset
    private let destination: URL
    private let progress: @Sendable (Int64) -> Void
    private let lock = NSLock()
    private var session: URLSession?
    private var continuation: CheckedContinuation<Void, Error>?
    private var finished = false

    init(source: URL, asset: PinnedParakeetAsset, destination: URL, progress: @escaping @Sendable (Int64) -> Void) {
        self.source = source
        self.asset = asset
        self.destination = destination
        self.progress = progress
    }

    func start() async throws {
        try await withCheckedThrowingContinuation { continuation in
            lock.lock()
            self.continuation = continuation
            lock.unlock()
            let configuration = URLSessionConfiguration.default
            configuration.timeoutIntervalForRequest = 180
            configuration.timeoutIntervalForResource = 3_600
            configuration.waitsForConnectivity = true
            let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            self.session = session
            session.downloadTask(with: source).resume()
        }
    }

    func cancel() {
        session?.invalidateAndCancel()
        finish(.failure(CancellationError()))
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        progress(min(asset.byteCount, totalBytesWritten))
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        do {
            guard let response = downloadTask.response as? HTTPURLResponse,
                  (200...299).contains(response.statusCode) else {
                throw ParakeetModelError.badResponse
            }
            try PinnedParakeetAssets.validate(asset, at: location)
            try FileManager.default.createDirectory(
                at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.moveItem(at: location, to: destination)
            finish(.success(()))
        } catch {
            finish(.failure(error))
        }
        session.finishTasksAndInvalidate()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { finish(.failure(error)) }
    }

    private func finish(_ result: Result<Void, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let continuation = continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(with: result)
    }
}
