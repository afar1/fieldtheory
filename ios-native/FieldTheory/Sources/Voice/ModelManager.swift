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
/// never needs the network.
@MainActor
@Observable
final class ModelManager {
    static let fileName = "ggml-base.en.bin"
    static let expectedMD5 = "4279db3d7b18d9f6e4d5817a16af4f09"
    static let downloadURL = URL(string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin")!

    private(set) var state: ModelState = .notDownloaded
    private var downloadTask: Task<Void, Never>?

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
        guard state == .notDownloaded || isFailed else { return }
        downloadTask?.cancel()
        downloadTask = Task { await download() }
    }

    private var isFailed: Bool {
        if case .failed = state { return true }
        return false
    }

    private func download() async {
        state = .downloading(progress: 0)
        do {
            let (bytes, response) = try await URLSession.shared.bytes(from: Self.downloadURL)
            let total = response.expectedContentLength
            let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("model-download.bin")
            FileManager.default.createFile(atPath: tempURL.path, contents: nil)
            let handle = try FileHandle(forWritingTo: tempURL)
            defer { try? handle.close() }

            var received: Int64 = 0
            var buffer = Data(capacity: 1 << 16)
            var lastReportedProgress = 0.0
            for try await byte in bytes {
                buffer.append(byte)
                if buffer.count >= 1 << 16 {
                    try handle.write(contentsOf: buffer)
                    received += Int64(buffer.count)
                    buffer.removeAll(keepingCapacity: true)
                    if total > 0 {
                        let progress = Double(received) / Double(total)
                        if progress - lastReportedProgress > 0.01 {
                            lastReportedProgress = progress
                            state = .downloading(progress: progress)
                        }
                    }
                }
            }
            if !buffer.isEmpty {
                try handle.write(contentsOf: buffer)
            }
            try handle.close()

            let digest = try Hashing.md5Hex(of: tempURL)
            guard digest == Self.expectedMD5 else {
                try? FileManager.default.removeItem(at: tempURL)
                state = .failed("Model checksum mismatch — try again")
                return
            }

            try FileManager.default.createDirectory(at: modelURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? FileManager.default.removeItem(at: modelURL)
            try FileManager.default.moveItem(at: tempURL, to: modelURL)
            state = .ready
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
