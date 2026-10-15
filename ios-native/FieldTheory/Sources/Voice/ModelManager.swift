import CryptoKit
import Foundation
import Observation

enum ModelState: Equatable {
    case notDownloaded
    case downloading(progress: Double)
    case ready
    case failed(String)
}

/// Downloads ggml-base.en.bin once (same pinned revision + MD5 the previous
/// app used) into Documents so it survives app updates. After that, speech
/// never needs the network. The transfer runs on URLSession's own queue —
/// nothing here touches the main thread except coarse progress updates.
@MainActor
@Observable
final class ModelManager {
    static let fileName = "ggml-base.en.bin"
    static let expectedMD5 = "4279db3d7b18d9f6e4d5817a16af4f09"
    static let downloadURL = URL(string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin")!

    private(set) var state: ModelState = .notDownloaded
    /// Fired on the main actor when the model transitions to ready.
    var onReady: (() -> Void)?

    private var downloader: ModelDownloader?

    var modelURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("models/\(Self.fileName)")
    }

    var readyModelURL: URL? {
        if case .ready = state { return modelURL }
        if FileManager.default.fileExists(atPath: modelURL.path) {
            state = .ready
            return modelURL
        }
        return nil
    }

    init() {
        if FileManager.default.fileExists(atPath: modelURL.path) {
            state = .ready
        }
    }

    func ensureDownloaded() {
        switch state {
        case .ready, .downloading:
            return
        case .notDownloaded, .failed:
            state = .downloading(progress: 0)
            startDownload()
        }
    }

    private func startDownload() {
        let destination = modelURL
        let downloader = ModelDownloader(
            onProgress: { [weak self] progress in
                Task { @MainActor [weak self] in
                    guard let self, case .downloading(let current) = self.state else { return }
                    if progress - current >= 0.01 {
                        self.state = .downloading(progress: progress)
                    }
                }
            },
            onFinish: { [weak self] result in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.downloader = nil
                    switch result {
                    case .success:
                        self.state = .ready
                        self.onReady?()
                    case .failure(let error):
                        self.state = .failed(error.localizedDescription)
                    }
                }
            },
            destination: destination,
            expectedMD5: Self.expectedMD5
        )
        self.downloader = downloader
        downloader.start(url: Self.downloadURL)
    }
}

/// Delegate-driven download: progress callbacks, then MD5 verification and
/// the final move into place — all off the main thread.
private final class ModelDownloader: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let onProgress: @Sendable (Double) -> Void
    private let onFinish: @Sendable (Result<Void, Error>) -> Void
    private let destination: URL
    private let expectedMD5: String
    private var session: URLSession?
    private var finished = false

    init(onProgress: @escaping @Sendable (Double) -> Void,
         onFinish: @escaping @Sendable (Result<Void, Error>) -> Void,
         destination: URL,
         expectedMD5: String) {
        self.onProgress = onProgress
        self.onFinish = onFinish
        self.destination = destination
        self.expectedMD5 = expectedMD5
    }

    func start(url: URL) {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 180      // tolerate a stalling CDN
        configuration.timeoutIntervalForResource = 3600    // a slow hour is still success
        configuration.waitsForConnectivity = true
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        self.session = session
        session.downloadTask(with: url).resume()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else { return }
        onProgress(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        // location is deleted when this method returns — finish synchronously.
        do {
            if let http = downloadTask.response as? HTTPURLResponse, http.statusCode != 200 {
                throw URLError(.badServerResponse)
            }
            let digest = try Self.md5HexStreaming(of: location)
            guard digest == expectedMD5 else {
                throw NSError(domain: "FieldTheory", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "Model checksum mismatch — try again",
                ])
            }
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: location, to: destination)
            finished = true
            onFinish(.success(()))
        } catch {
            finished = true
            onFinish(.failure(error))
        }
        session.invalidateAndCancel()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error, !finished {
            finished = true
            onFinish(.failure(error))
        }
        session.invalidateAndCancel()
    }

    /// MD5 in 1 MB chunks — never loads the whole model into memory.
    private static func md5HexStreaming(of fileURL: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { try? handle.close() }
        var hasher = Insecure.MD5()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
