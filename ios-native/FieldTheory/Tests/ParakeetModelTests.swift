import CryptoKit
import XCTest
@testable import FieldTheory

@MainActor
final class ParakeetModelTests: XCTestCase {
    func testConstructionDoesNotStartDownload() async throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let calls = DownloadCallCounter()
        let manager = ParakeetModelManager(
            modelDirectory: root,
            assets: [try vocabularyAsset()],
            downloadAsset: { asset, destination, _ in
                await calls.increment()
                try Self.writeVocabulary(to: destination)
            }
        )

        try await Task.sleep(for: .milliseconds(50))
        let downloadCount = await calls.value

        XCTAssertEqual(manager.state, .notDownloaded)
        XCTAssertNil(manager.readyModelDirectory)
        XCTAssertEqual(downloadCount, 0)
    }

    func testExplicitDownloadVerifiesAssetsAndPublishesReadyDirectory() async throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let calls = DownloadCallCounter()
        let manager = ParakeetModelManager(
            modelDirectory: root,
            assets: [try vocabularyAsset()],
            downloadAsset: { asset, destination, progress in
                await calls.increment()
                progress(asset.byteCount / 2)
                try Self.writeVocabulary(to: destination)
                progress(asset.byteCount)
            }
        )

        manager.download()
        await manager.waitForCurrentOperation()
        let downloadCount = await calls.value

        XCTAssertEqual(manager.state, .ready)
        XCTAssertEqual(manager.readyModelDirectory, root)
        XCTAssertEqual(downloadCount, 1)
        XCTAssertTrue(FileManager.default.fileExists(
            atPath: root.appendingPathComponent(PinnedParakeetAssets.receiptName).path))
    }

    func testCachedAssetsBecomeReadyWithoutDownloadOrReceipt() async throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        try Self.writeVocabulary(to: root.appendingPathComponent("parakeet_vocab.json"))
        let calls = DownloadCallCounter()
        let manager = ParakeetModelManager(
            modelDirectory: root,
            assets: [try vocabularyAsset()],
            downloadAsset: { _, _, _ in await calls.increment() }
        )

        await manager.waitForCurrentOperation()
        let downloadCount = await calls.value

        XCTAssertEqual(manager.state, .ready)
        XCTAssertEqual(manager.readyModelURL, root)
        XCTAssertEqual(downloadCount, 0)
    }

    func testCorruptCachedAssetFailsClosedWithoutDownloading() async throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let destination = root.appendingPathComponent("parakeet_vocab.json")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("{\"0\":\"b\"}".utf8).write(to: destination)
        let calls = DownloadCallCounter()
        let manager = ParakeetModelManager(
            modelDirectory: root,
            assets: [try vocabularyAsset()],
            downloadAsset: { _, _, _ in await calls.increment() }
        )

        await manager.waitForCurrentOperation()
        let downloadCount = await calls.value

        guard case .failed(let message) = manager.state else {
            return XCTFail("Corrupt cache was accepted")
        }
        XCTAssertTrue(message.contains("could not be verified"))
        XCTAssertNil(manager.readyModelURL)
        XCTAssertEqual(downloadCount, 0)
    }

    func testDownloadFailureIsVisibleAndRetryable() async throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let calls = DownloadCallCounter()
        let manager = ParakeetModelManager(
            modelDirectory: root,
            assets: [try vocabularyAsset()],
            downloadAsset: { _, destination, _ in
                let attempt = await calls.increment()
                if attempt == 1 { throw URLError(.notConnectedToInternet) }
                try Self.writeVocabulary(to: destination)
            }
        )

        manager.download()
        await manager.waitForCurrentOperation()
        guard case .failed = manager.state else { return XCTFail("Failure was hidden") }

        manager.retryDownload()
        await manager.waitForCurrentOperation()
        let downloadCount = await calls.value

        XCTAssertEqual(manager.state, .ready)
        XCTAssertEqual(downloadCount, 2)
    }

    func testReadyStateFailsClosedIfAnAssetDisappears() async throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let asset = try vocabularyAsset()
        let manager = ParakeetModelManager(
            modelDirectory: root,
            assets: [asset],
            downloadAsset: { _, destination, _ in try Self.writeVocabulary(to: destination) }
        )
        manager.download()
        await manager.waitForCurrentOperation()
        try FileManager.default.removeItem(at: root.appendingPathComponent(asset.path))

        XCTAssertNil(manager.readyModelDirectory)
        guard case .failed(let message) = manager.state else {
            return XCTFail("Missing ready asset did not invalidate readiness")
        }
        XCTAssertTrue(message.contains("incomplete"))
    }

    func testBackgroundPlanSchedulesEveryMissingAssetAndSkipsActiveTasks() async throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let first = try asset(path: "one.bin", data: Data("one".utf8))
        let second = try asset(path: "nested/two.bin", data: Data("two".utf8))
        let third = try asset(path: "three.bin", data: Data("three".utf8))
        try Self.write(Data("one".utf8), to: root.appendingPathComponent(first.path))

        let plan = await ParakeetBackgroundDownloader.assetsNeedingNewTasks(
            [first, second, third], in: root, activePaths: [second.path])

        XCTAssertEqual(plan.invalidPaths, [second.path, third.path])
        XCTAssertEqual(plan.assetsToSchedule.map(\.path), [third.path])
    }

    func testBackgroundInstallRejectsInvalidTemporaryFileWithoutReplacingLocalAsset() throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let expected = Data("expected".utf8)
        let existing = Data("existing".utf8)
        let asset = try asset(path: "asset.bin", data: expected)
        let temporary = root.appendingPathComponent("temporary.bin")
        let destination = root.appendingPathComponent(asset.path)
        try Self.write(Data("corrupt".utf8), to: temporary)
        try Self.write(existing, to: destination)

        XCTAssertThrowsError(try ParakeetBackgroundDownloader.installDownloadedAsset(
            asset, from: temporary, to: destination))
        XCTAssertEqual(try Data(contentsOf: destination), existing)
    }

    func testBackgroundInstallAtomicallyReplacesInvalidLocalAsset() throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let expected = Data("expected".utf8)
        let asset = try asset(path: "nested/asset.bin", data: expected)
        let temporary = root.appendingPathComponent("temporary.bin")
        let destination = root.appendingPathComponent(asset.path)
        try Self.write(expected, to: temporary)
        try Self.write(Data("old".utf8), to: destination)

        try ParakeetBackgroundDownloader.installDownloadedAsset(
            asset, from: temporary, to: destination)

        XCTAssertEqual(try Data(contentsOf: destination), expected)
        XCTAssertFalse(FileManager.default.fileExists(atPath: temporary.path))
    }

    func testBackgroundDownloadMovesIntoDurableStagingBeforeChecksum() throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let asset = try asset(path: "nested/asset.bin", data: Data("expected".utf8))
        let temporary = root.appendingPathComponent("system-temporary.bin")
        try Self.write(Data("corrupt".utf8), to: temporary)

        let staged = try ParakeetBackgroundDownloader.stageDownloadedAsset(
            asset, from: temporary, in: root)

        XCTAssertFalse(FileManager.default.fileExists(atPath: temporary.path))
        XCTAssertEqual(try Data(contentsOf: staged), Data("corrupt".utf8))
        XCTAssertThrowsError(
            try ParakeetBackgroundDownloader.promoteStagedAsset(asset, in: root))
        XCTAssertTrue(FileManager.default.fileExists(atPath: staged.path))
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: root.appendingPathComponent(asset.path).path))
    }

    func testRelaunchFinalizationKeepsIntentUntilWholeManifestIsValid() throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let expected = Data("{\"0\":\"model\"}".utf8)
        let asset = try asset(path: "parakeet_vocab.json", data: expected)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let intent = root.appendingPathComponent(ParakeetBackgroundDownloader.intentName)
        try Data("intent".utf8).write(to: intent)

        XCTAssertThrowsError(try ParakeetBackgroundDownloader.finalizeDownloadedModel(
            in: root, assets: [asset]))
        XCTAssertTrue(FileManager.default.fileExists(atPath: intent.path))
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: root.appendingPathComponent(PinnedParakeetAssets.receiptName).path))

        try Self.write(expected, to: root.appendingPathComponent(asset.path))
        try ParakeetBackgroundDownloader.finalizeDownloadedModel(in: root, assets: [asset])
        XCTAssertFalse(FileManager.default.fileExists(atPath: intent.path))
        XCTAssertTrue(FileManager.default.fileExists(
            atPath: root.appendingPathComponent(PinnedParakeetAssets.receiptName).path))
    }

    func testBackgroundRelaunchWithoutTasksFinalizesBeforeCompletingEvents() async throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let data = Data("{\"0\":\"model\"}".utf8)
        let asset = try asset(path: "parakeet_vocab.json", data: data)
        try Self.write(
            data,
            to: root.appendingPathComponent(
                ParakeetBackgroundDownloader.stagingDirectoryName,
                isDirectory: true
            ).appendingPathComponent(asset.path))
        try Self.write(
            Data("intent".utf8),
            to: root.appendingPathComponent(ParakeetBackgroundDownloader.intentName))
        let identifier = "com.afar1.fieldtheory.tests.background-ready-\(UUID().uuidString)"
        let downloader = ParakeetBackgroundDownloader(sessionIdentifier: identifier)
        let ready = expectation(description: "whole manifest became ready")
        ready.assertForOverFulfill = false
        let completion = expectation(description: "background events completed")
        var completionObservedReady = false
        let observer = NotificationCenter.default.addObserver(
            forName: .parakeetBackgroundDownloadChanged,
            object: downloader,
            queue: .main
        ) { notification in
            guard let snapshot = notification.userInfo?["snapshot"]
                    as? ParakeetBackgroundDownloadSnapshot,
                  case .ready = snapshot.phase else { return }
            ready.fulfill()
        }
        defer { NotificationCenter.default.removeObserver(observer) }

        downloader.reconnect(modelDirectory: root, assets: [asset])
        downloader.handleEvents(for: identifier) {
            if case .ready = downloader.snapshot(for: root).phase {
                completionObservedReady = true
            }
            completion.fulfill()
        }
        downloader.urlSessionDidFinishEvents(forBackgroundURLSession: .shared)

        await fulfillment(of: [ready, completion], timeout: 5)
        XCTAssertTrue(completionObservedReady)
        XCTAssertFalse(downloader.hasPersistedIntent(in: root))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(asset.path)), data)
    }

    func testBackgroundRelaunchWithoutTasksFailsActionablyBeforeCompletingEvents() async throws {
        let root = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let data = Data("{\"0\":\"model\"}".utf8)
        let asset = try asset(path: "parakeet_vocab.json", data: data)
        try Self.write(
            Data("intent".utf8),
            to: root.appendingPathComponent(ParakeetBackgroundDownloader.intentName))
        let identifier = "com.afar1.fieldtheory.tests.background-failed-\(UUID().uuidString)"
        let downloader = ParakeetBackgroundDownloader(sessionIdentifier: identifier)
        let failed = expectation(description: "incomplete manifest became actionable failure")
        failed.assertForOverFulfill = false
        let completion = expectation(description: "background events completed")
        var completionObservedFailure = false
        let observer = NotificationCenter.default.addObserver(
            forName: .parakeetBackgroundDownloadChanged,
            object: downloader,
            queue: .main
        ) { notification in
            guard let snapshot = notification.userInfo?["snapshot"]
                    as? ParakeetBackgroundDownloadSnapshot,
                  case .failed = snapshot.phase else { return }
            failed.fulfill()
        }
        defer { NotificationCenter.default.removeObserver(observer) }

        downloader.reconnect(modelDirectory: root, assets: [asset])
        downloader.handleEvents(for: identifier) {
            if case .failed = downloader.snapshot(for: root).phase {
                completionObservedFailure = true
            }
            completion.fulfill()
        }
        downloader.urlSessionDidFinishEvents(forBackgroundURLSession: .shared)

        await fulfillment(of: [failed, completion], timeout: 5)
        XCTAssertTrue(completionObservedFailure)
        XCTAssertTrue(downloader.hasPersistedIntent(in: root))
    }

    func testServiceRejectsMissingLocalAssetsWithoutCreatingThem() async throws {
        let root = temporaryDirectory()
        let audio = temporaryDirectory().appendingPathExtension("wav")
        defer {
            try? FileManager.default.removeItem(at: root)
            try? FileManager.default.removeItem(at: audio)
        }
        try Data().write(to: audio)

        do {
            _ = try await ParakeetService().transcribe(audioURL: audio, modelDirectory: root)
            XCTFail("Missing model was accepted")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("not ready"))
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
    }

    func testConcurrentPrepareCallsShareOneRuntimeLoad() async throws {
        let loader = ControlledParakeetRuntimeLoader()
        let service = ParakeetService(runtimeLoader: { directory in
            try await loader.load(directory: directory)
        })
        let directory = temporaryDirectory()

        let first = Task { try await service.prepare(modelDirectory: directory) }
        let second = Task { try await service.prepare(modelDirectory: directory) }
        await loader.waitUntilStarted()
        var loadCount = await loader.loadCount
        XCTAssertEqual(loadCount, 1)

        await loader.releaseLoads()
        let firstDiagnostics = try await first.value
        let secondDiagnostics = try await second.value
        XCTAssertFalse(firstDiagnostics.cacheHit)
        XCTAssertFalse(secondDiagnostics.cacheHit)
        loadCount = await loader.loadCount
        XCTAssertEqual(loadCount, 1)

        let cached = try await service.prepare(modelDirectory: directory)
        XCTAssertTrue(cached.cacheHit)
        loadCount = await loader.loadCount
        XCTAssertEqual(loadCount, 1)
    }

    func testTranscribeJoinsInProgressPreparation() async throws {
        let loader = ControlledParakeetRuntimeLoader(transcript: "prepared result")
        let service = ParakeetService(runtimeLoader: { directory in
            try await loader.load(directory: directory)
        })
        let directory = temporaryDirectory()
        let audio = temporaryDirectory().appendingPathExtension("wav")
        defer { try? FileManager.default.removeItem(at: audio) }
        try Data([0]).write(to: audio)

        let preparation = Task { try await service.prepare(modelDirectory: directory) }
        await loader.waitUntilStarted()
        let transcription = Task {
            try await service.transcribe(audioURL: audio, modelDirectory: directory)
        }
        await Task.yield()
        var loadCount = await loader.loadCount
        XCTAssertEqual(loadCount, 1)

        await loader.releaseLoads()
        _ = try await preparation.value
        let result = try await transcription.value
        loadCount = await loader.loadCount
        let transcriptionCount = await loader.transcriptionCount
        XCTAssertEqual(result, "prepared result")
        XCTAssertEqual(loadCount, 1)
        XCTAssertEqual(transcriptionCount, 1)
    }

    func testCancelledWaiterReturnsWithoutCancellingSharedPreparation() async throws {
        let loader = ControlledParakeetRuntimeLoader()
        let service = ParakeetService(runtimeLoader: { directory in
            try await loader.load(directory: directory)
        })
        let directory = temporaryDirectory()
        let first = Task { try await service.prepare(modelDirectory: directory) }
        await loader.waitUntilStarted()

        let cancelled = Task { try await service.prepare(modelDirectory: directory) }
        await Task.yield()
        cancelled.cancel()
        let cancellationReturned = expectation(description: "cancelled waiter returned")
        Task {
            guard case .failure(let error) = await cancelled.result else {
                XCTFail("Cancelled preparation unexpectedly succeeded")
                cancellationReturned.fulfill()
                return
            }
            XCTAssertTrue(error is CancellationError)
            cancellationReturned.fulfill()
        }
        await fulfillment(of: [cancellationReturned], timeout: 0.5)
        var loadCount = await loader.loadCount
        XCTAssertEqual(loadCount, 1)

        await loader.releaseLoads()
        _ = try await first.value
        _ = try await service.prepare(modelDirectory: directory)
        loadCount = await loader.loadCount
        XCTAssertEqual(loadCount, 1)
    }

    func testUnloadInvalidatesWaitersAndDiscardsLateRuntime() async throws {
        let loader = ControlledParakeetRuntimeLoader()
        let service = ParakeetService(runtimeLoader: { directory in
            try await loader.load(directory: directory)
        })
        let directory = temporaryDirectory()
        let preparation = Task { try await service.prepare(modelDirectory: directory) }
        await loader.waitUntilStarted()

        await service.unload()
        guard case .failure(let error) = await preparation.result else {
            return XCTFail("Unloaded preparation unexpectedly succeeded")
        }
        XCTAssertTrue(error is CancellationError)

        // Simulate a non-cooperative Core ML call completing after cancellation.
        await loader.releaseLoads()
        await loader.waitUntilCleanedUp()
        let cleanupCount = await loader.cleanupCount
        XCTAssertEqual(cleanupCount, 1)

        let retry = Task { try await service.prepare(modelDirectory: directory) }
        await loader.waitUntilLoadCount(2)
        await loader.releaseLoads()
        _ = try await retry.value
        let loadCount = await loader.loadCount
        XCTAssertEqual(loadCount, 2)
    }

    func testPreparationDiagnosticsContainNoPathsOrContent() async throws {
        let loader = ControlledParakeetRuntimeLoader(transcript: "private spoken words")
        let service = ParakeetService(runtimeLoader: { directory in
            try await loader.load(directory: directory)
        })
        let directory = temporaryDirectory()
        let preparation = Task { try await service.prepare(modelDirectory: directory) }
        await loader.waitUntilStarted()
        await loader.releaseLoads()
        let diagnostics = try await preparation.value

        let json = String(decoding: try JSONEncoder().encode(diagnostics), as: UTF8.self)
        XCTAssertTrue(json.contains("warmingInference"))
        XCTAssertFalse(json.contains(directory.path))
        XCTAssertFalse(json.contains("private spoken words"))
    }

    func testFirstPreparationDiagnosticsPersistAndSurviveCacheHits() async throws {
        let loader = ControlledParakeetRuntimeLoader()
        let root = temporaryDirectory()
        let diagnosticsURL = root.appendingPathComponent("diagnostics/preparation.json")
        defer { try? FileManager.default.removeItem(at: root) }
        let service = ParakeetService(
            runtimeLoader: { directory in try await loader.load(directory: directory) },
            diagnosticsURL: diagnosticsURL)

        let preparation = Task { try await service.prepare(modelDirectory: root) }
        await loader.waitUntilStarted()
        await loader.releaseLoads()
        let first = try await preparation.value
        XCTAssertFalse(first.cacheHit)

        let cached = try await service.prepare(modelDirectory: root)
        XCTAssertTrue(cached.cacheHit)
        let persisted = try JSONDecoder().decode(
            ParakeetPreparationDiagnostics.self, from: Data(contentsOf: diagnosticsURL))
        XCTAssertEqual(persisted, first)
        XCTAssertFalse(persisted.cacheHit)
        let latest = await service.latestPreparationDiagnostics
        XCTAssertEqual(latest, first)
    }

    func testConcurrentInferenceIsSerialAndCancelledWaiterNeverEntersRuntime() async throws {
        let probe = SerialParakeetInferenceProbe()
        let service = ParakeetService(runtimeLoader: { _ in
            ParakeetLoadedRuntimeResult(
                runtime: ParakeetLoadedRuntime(
                    transcribe: { _ in try await probe.run() },
                    cleanup: {}),
                diagnostics: ParakeetPreparationDiagnostics(
                    modelIdentity: "test-parakeet",
                    outcome: .ready,
                    failedStage: nil,
                    stageTimings: [.init(stage: .warmingInference, durationMs: 1)],
                    totalMs: 1,
                    cacheHit: false))
        })
        let directory = temporaryDirectory()
        let audio = temporaryDirectory().appendingPathExtension("wav")
        defer { try? FileManager.default.removeItem(at: audio) }
        try Data([0]).write(to: audio)
        _ = try await service.prepare(modelDirectory: directory)

        let first = Task {
            try await service.transcribe(audioURL: audio, modelDirectory: directory)
        }
        await probe.waitUntilEntryCount(1)
        let cancelled = Task {
            try await service.transcribe(audioURL: audio, modelDirectory: directory)
        }
        await Task.yield()
        cancelled.cancel()
        guard case .failure(let cancellationError) = await cancelled.result else {
            return XCTFail("Cancelled queued inference unexpectedly ran")
        }
        XCTAssertTrue(cancellationError is CancellationError)
        var entryCount = await probe.entryCount
        XCTAssertEqual(entryCount, 1)

        await probe.releaseOne()
        let firstResult = try await first.value
        XCTAssertEqual(firstResult, "fixture")

        let third = Task {
            try await service.transcribe(audioURL: audio, modelDirectory: directory)
        }
        await probe.waitUntilEntryCount(2)
        await probe.releaseOne()
        let thirdResult = try await third.value
        XCTAssertEqual(thirdResult, "fixture")
        entryCount = await probe.entryCount
        let maximumConcurrent = await probe.maximumConcurrent
        XCTAssertEqual(entryCount, 2)
        XCTAssertEqual(maximumConcurrent, 1)
    }

    func testPinnedManifestHasExpectedRevisionAndByteCount() {
        XCTAssertEqual(PinnedParakeetAssets.revision, "ee09c569f73759e6d44c9bd16766f477b2b36d39")
        XCTAssertEqual(
            PinnedParakeetAssets.v2English.reduce(Int64(0)) { $0 + $1.byteCount },
            464_413_247
        )
        XCTAssertEqual(Set(PinnedParakeetAssets.v2English.map(\.path)).count, 21)
    }

    private func temporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("parakeet-tests-\(UUID().uuidString)", isDirectory: true)
    }

    private func vocabularyAsset() throws -> PinnedParakeetAsset {
        let data = Data("{\"0\":\"a\"}".utf8)
        return PinnedParakeetAsset(
            path: "parakeet_vocab.json",
            byteCount: Int64(data.count),
            sha256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        )
    }

    private func asset(path: String, data: Data) throws -> PinnedParakeetAsset {
        PinnedParakeetAsset(
            path: path,
            byteCount: Int64(data.count),
            sha256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined())
    }

    nonisolated private static func write(_ data: Data, to url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic])
    }

    nonisolated private static func writeVocabulary(to url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{\"0\":\"a\"}".utf8).write(to: url, options: [.atomic])
    }
}

private actor DownloadCallCounter {
    private var count = 0
    var value: Int { count }

    @discardableResult
    func increment() -> Int {
        count += 1
        return count
    }
}

private actor ControlledParakeetRuntimeLoader {
    private(set) var loadCount = 0
    private(set) var transcriptionCount = 0
    private(set) var cleanupCount = 0
    private var startedWaiters: [CheckedContinuation<Void, Never>] = []
    private var loadCountWaiters: [(Int, CheckedContinuation<Void, Never>)] = []
    private var cleanupWaiters: [CheckedContinuation<Void, Never>] = []
    private var loadWaiters: [CheckedContinuation<Void, Never>] = []
    private var hasStarted = false
    private let transcript: String

    init(transcript: String = "fixture") {
        self.transcript = transcript
    }

    func waitUntilStarted() async {
        if hasStarted { return }
        await withCheckedContinuation { startedWaiters.append($0) }
    }


    func waitUntilLoadCount(_ count: Int) async {
        if loadCount >= count { return }
        await withCheckedContinuation { loadCountWaiters.append((count, $0)) }
    }

    func waitUntilCleanedUp() async {
        if cleanupCount > 0 { return }
        await withCheckedContinuation { cleanupWaiters.append($0) }
    }

    func releaseLoads() {
        let waiters = loadWaiters
        loadWaiters.removeAll()
        waiters.forEach { $0.resume() }
    }

    func load(directory: URL) async throws -> ParakeetLoadedRuntimeResult {
        loadCount += 1
        hasStarted = true
        let waiters = startedWaiters
        startedWaiters.removeAll()
        waiters.forEach { $0.resume() }
        let readyCountWaiters = loadCountWaiters.filter { loadCount >= $0.0 }
        loadCountWaiters.removeAll { loadCount >= $0.0 }
        readyCountWaiters.forEach { $0.1.resume() }
        await withCheckedContinuation { loadWaiters.append($0) }

        let transcript = self.transcript
        return ParakeetLoadedRuntimeResult(
            runtime: ParakeetLoadedRuntime(
                transcribe: { _ in
                    await self.noteTranscription()
                    return transcript
                },
                cleanup: { await self.noteCleanup() }),
            diagnostics: ParakeetPreparationDiagnostics(
                modelIdentity: "test-parakeet",
                outcome: .ready,
                failedStage: nil,
                stageTimings: [.init(stage: .warmingInference, durationMs: 17)],
                totalMs: 17,
                cacheHit: false))
    }

    private func noteTranscription() {
        transcriptionCount += 1
    }

    private func noteCleanup() {
        cleanupCount += 1
        let waiters = cleanupWaiters
        cleanupWaiters.removeAll()
        waiters.forEach { $0.resume() }
    }
}

private actor SerialParakeetInferenceProbe {
    private(set) var entryCount = 0
    private(set) var maximumConcurrent = 0
    private var activeCount = 0
    private var entryWaiters: [(Int, CheckedContinuation<Void, Never>)] = []
    private var runWaiters: [CheckedContinuation<Void, Never>] = []

    func waitUntilEntryCount(_ count: Int) async {
        if entryCount >= count { return }
        await withCheckedContinuation { entryWaiters.append((count, $0)) }
    }

    func releaseOne() {
        guard !runWaiters.isEmpty else { return }
        runWaiters.removeFirst().resume()
    }

    func run() async throws -> String {
        entryCount += 1
        activeCount += 1
        maximumConcurrent = max(maximumConcurrent, activeCount)
        let ready = entryWaiters.filter { entryCount >= $0.0 }
        entryWaiters.removeAll { entryCount >= $0.0 }
        ready.forEach { $0.1.resume() }
        await withCheckedContinuation { runWaiters.append($0) }
        activeCount -= 1
        return "fixture"
    }
}
