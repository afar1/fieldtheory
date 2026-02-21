import Foundation

enum FieldTheoryHelperBridgeError: LocalizedError {
    case binaryNotFound(String)
    case processLaunchFailed(String)
    case requestInFlight
    case timedOut(String)
    case invalidResponse(String)
    case helperError(String)
    case processExited(String)

    var errorDescription: String? {
        switch self {
        case .binaryNotFound(let message),
             .processLaunchFailed(let message),
             .timedOut(let message),
             .invalidResponse(let message),
             .helperError(let message),
             .processExited(let message):
            return message
        case .requestInFlight:
            return "Helper request already in flight."
        }
    }
}

final class FieldTheoryHelperBridge: @unchecked Sendable {
    private final class PendingRequest {
        let expectedTypes: Set<String>
        let semaphore = DispatchSemaphore(value: 0)
        var response: [String: Any]?
        var error: Error?

        init(expectedTypes: Set<String>) {
            self.expectedTypes = expectedTypes
        }
    }

    private final class StartupWaiter {
        let semaphore = DispatchSemaphore(value: 0)
        var error: Error?
    }

    var onAudioLevel: ((Double, Bool) -> Void)?
    var onRecordingChunkReady: ((URL) -> Void)?

    private let executableURL: URL
    private let fileManager: FileManager
    private let queue = DispatchQueue(label: "FieldTheoryNative.HelperBridge")

    private var process: Process?
    private var stdinHandle: FileHandle?
    private var stdoutHandle: FileHandle?
    private var stderrHandle: FileHandle?
    private var stdoutBuffer = Data()
    private var stderrBuffer = Data()
    private var recentStderrLines: [String] = []
    private var startupWaiter: StartupWaiter?
    private var pendingRequest: PendingRequest?

    init(executableURL: URL, fileManager: FileManager = .default) {
        self.executableURL = executableURL
        self.fileManager = fileManager
    }

    deinit {
        stop()
    }

    func startIfNeeded() throws {
        let waiter = try queue.sync {
            try startIfNeededLocked()
        }

        guard let waiter else { return }

        let waitResult = waiter.semaphore.wait(timeout: .now() + 3)
        if waitResult == .timedOut {
            let stderrSummary = queue.sync { recentStderrSummaryLocked() }
            stop()
            throw FieldTheoryHelperBridgeError.processLaunchFailed("FieldTheoryHelper did not emit a startup message in time.\(stderrSummary)")
        }

        if let error = waiter.error {
            throw error
        }
    }

    func stop() {
        queue.sync {
            stopLocked()
        }
    }

    func send(_ command: [String: Any]) throws {
        try queue.sync {
            _ = try startIfNeededLocked()
            try writeCommandLocked(command)
        }
    }

    func request(
        _ command: [String: Any],
        expecting expectedTypes: Set<String>,
        timeout: TimeInterval
    ) throws -> [String: Any] {
        let pending = PendingRequest(expectedTypes: expectedTypes)

        try queue.sync {
            _ = try startIfNeededLocked()
            guard pendingRequest == nil else {
                throw FieldTheoryHelperBridgeError.requestInFlight
            }
            pendingRequest = pending
            try writeCommandLocked(command)
        }

        let waitResult = pending.semaphore.wait(timeout: .now() + timeout)
        if waitResult == .timedOut {
            queue.sync {
                if pendingRequest === pending {
                    pendingRequest = nil
                }
            }
            throw FieldTheoryHelperBridgeError.timedOut("Helper request timed out for command type '\(command["type"] as? String ?? "unknown")'.")
        }

        if let error = pending.error {
            throw error
        }

        guard let response = pending.response else {
            throw FieldTheoryHelperBridgeError.invalidResponse("Helper returned no response payload.")
        }

        return response
    }

    private func startIfNeededLocked() throws -> StartupWaiter? {
        if let process, process.isRunning {
            return startupWaiter
        }

        guard fileManager.isExecutableFile(atPath: executableURL.path) else {
            throw FieldTheoryHelperBridgeError.binaryNotFound("FieldTheoryHelper not found at \(executableURL.path).")
        }

        let process = Process()
        process.executableURL = executableURL
        process.arguments = []

        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        do {
            try process.run()
        } catch {
            throw FieldTheoryHelperBridgeError.processLaunchFailed("Failed to launch FieldTheoryHelper: \(error.localizedDescription)")
        }

        self.process = process
        stdinHandle = stdinPipe.fileHandleForWriting
        stdoutHandle = stdoutPipe.fileHandleForReading
        stderrHandle = stderrPipe.fileHandleForReading
        stdoutBuffer.removeAll(keepingCapacity: true)
        stderrBuffer.removeAll(keepingCapacity: true)
        recentStderrLines.removeAll(keepingCapacity: true)

        let waiter = StartupWaiter()
        startupWaiter = waiter

        stdoutHandle?.readabilityHandler = { [weak self] handle in
            guard let self else { return }
            let data = handle.availableData
            self.queue.sync {
                self.handleStdoutDataLocked(data)
            }
        }

        stderrHandle?.readabilityHandler = { [weak self] handle in
            guard let self else { return }
            let data = handle.availableData
            self.queue.sync {
                self.handleStderrDataLocked(data)
            }
        }

        process.terminationHandler = { [weak self] process in
            guard let self else { return }
            self.queue.sync {
                self.handleProcessTerminationLocked(status: process.terminationStatus)
            }
        }

        return waiter
    }

    private func stopLocked() {
        stdoutHandle?.readabilityHandler = nil
        stderrHandle?.readabilityHandler = nil
        stdinHandle = nil
        stdoutHandle = nil
        stderrHandle = nil
        stdoutBuffer.removeAll(keepingCapacity: false)
        stderrBuffer.removeAll(keepingCapacity: false)
        recentStderrLines.removeAll(keepingCapacity: false)

        if let process, process.isRunning {
            process.terminate()
        }
        self.process = nil

        if let startupWaiter {
            startupWaiter.error = FieldTheoryHelperBridgeError.processExited("FieldTheoryHelper process stopped.\(recentStderrSummaryLocked())")
            startupWaiter.semaphore.signal()
            self.startupWaiter = nil
        }

        if let pendingRequest {
            pendingRequest.error = FieldTheoryHelperBridgeError.processExited("FieldTheoryHelper process stopped.\(recentStderrSummaryLocked())")
            pendingRequest.semaphore.signal()
            self.pendingRequest = nil
        }
    }

    private func handleProcessTerminationLocked(status: Int32) {
        stdoutHandle?.readabilityHandler = nil
        stderrHandle?.readabilityHandler = nil
        stdinHandle = nil
        stdoutHandle = nil
        stderrHandle = nil
        process = nil
        stdoutBuffer.removeAll(keepingCapacity: false)
        stderrBuffer.removeAll(keepingCapacity: false)

        if let startupWaiter {
            startupWaiter.error = FieldTheoryHelperBridgeError.processExited("FieldTheoryHelper exited with status \(status).\(recentStderrSummaryLocked())")
            startupWaiter.semaphore.signal()
            self.startupWaiter = nil
        }

        if let pendingRequest {
            pendingRequest.error = FieldTheoryHelperBridgeError.processExited("FieldTheoryHelper exited with status \(status).\(recentStderrSummaryLocked())")
            pendingRequest.semaphore.signal()
            self.pendingRequest = nil
        }
    }

    private func writeCommandLocked(_ command: [String: Any]) throws {
        guard let stdinHandle else {
            throw FieldTheoryHelperBridgeError.processExited("FieldTheoryHelper stdin unavailable.")
        }

        let data: Data
        do {
            data = try JSONSerialization.data(withJSONObject: command, options: [])
        } catch {
            throw FieldTheoryHelperBridgeError.invalidResponse("Failed to encode helper command: \(error.localizedDescription)")
        }

        var line = data
        line.append(0x0A)
        stdinHandle.write(line)
    }

    private func handleStdoutDataLocked(_ data: Data) {
        guard data.isEmpty == false else { return }

        stdoutBuffer.append(data)

        while let newlineRange = stdoutBuffer.range(of: Data([0x0A])) {
            let lineData = stdoutBuffer.subdata(in: 0..<newlineRange.lowerBound)
            stdoutBuffer.removeSubrange(0..<newlineRange.upperBound)

            guard let line = String(data: lineData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
                line.isEmpty == false else {
                continue
            }

            handleStdoutLineLocked(line)
        }
    }

    private func handleStderrDataLocked(_ data: Data) {
        guard data.isEmpty == false else { return }
        stderrBuffer.append(data)

        while let newlineRange = stderrBuffer.range(of: Data([0x0A])) {
            let lineData = stderrBuffer.subdata(in: 0..<newlineRange.lowerBound)
            stderrBuffer.removeSubrange(0..<newlineRange.upperBound)
            guard
                let line = String(data: lineData, encoding: .utf8)?
                    .trimmingCharacters(in: .whitespacesAndNewlines),
                line.isEmpty == false
            else {
                continue
            }

            recentStderrLines.append(line)
            if recentStderrLines.count > 8 {
                recentStderrLines.removeFirst(recentStderrLines.count - 8)
            }
        }
    }

    private func handleStdoutLineLocked(_ line: String) {
        guard
            let data = line.data(using: .utf8),
            let jsonObject = try? JSONSerialization.jsonObject(with: data, options: []),
            let payload = jsonObject as? [String: Any],
            let type = payload["type"] as? String
        else {
            return
        }

        if let startupWaiter {
            if type == "error" {
                let message = payload["message"] as? String ?? "Unknown helper startup error."
                startupWaiter.error = FieldTheoryHelperBridgeError.helperError(message)
            }
            startupWaiter.semaphore.signal()
            self.startupWaiter = nil
        }

        if type == "audioLevel" {
            let level = payload["level"] as? Double ?? 0
            let isSpeech = payload["isSpeech"] as? Bool ?? (level > 0.02)
            let callback = onAudioLevel
            DispatchQueue.main.async {
                callback?(level, isSpeech)
            }
        }

        if type == "recordingChunkReady", let path = payload["filePath"] as? String {
            let callback = onRecordingChunkReady
            let url = URL(fileURLWithPath: path, isDirectory: false)
            callback?(url)
        }

        guard let pendingRequest else { return }

        if type == "error" {
            let message = payload["message"] as? String ?? "Unknown helper error."
            pendingRequest.error = FieldTheoryHelperBridgeError.helperError(message)
            pendingRequest.semaphore.signal()
            self.pendingRequest = nil
            return
        }

        if pendingRequest.expectedTypes.contains(type) {
            pendingRequest.response = payload
            pendingRequest.semaphore.signal()
            self.pendingRequest = nil
        }
    }

    private func recentStderrSummaryLocked() -> String {
        guard recentStderrLines.isEmpty == false else {
            return ""
        }
        return " stderr=\(recentStderrLines.joined(separator: " | "))"
    }
}

final class HelperRecordingController: RecordingController {
    let backend: TranscriptionRecordingBackendKind = .helper
    let supportsSnapshots: Bool = true

    private let bridge: FieldTheoryHelperBridge
    private let chunkQueue = DispatchQueue(label: "FieldTheoryNative.HelperRecordingController.chunks")
    private var readyChunks: [URL] = []

    init(helperExecutableURL: URL, bridge: FieldTheoryHelperBridge? = nil) throws {
        if let bridge {
            self.bridge = bridge
        } else {
            self.bridge = FieldTheoryHelperBridge(executableURL: helperExecutableURL)
        }
        self.bridge.onRecordingChunkReady = { [weak self] url in
            self?.appendReadyChunk(url)
        }
        try self.bridge.startIfNeeded()
    }

    func startRecording(preferredOutputURL url: URL) throws {
        _ = url
        chunkQueue.sync {
            readyChunks.removeAll(keepingCapacity: true)
        }
        _ = try bridge.request(
            ["type": "startRecording"],
            expecting: ["recordingStarted"],
            timeout: 5
        )
    }

    func stopRecording() throws -> URL {
        let response = try bridge.request(
            ["type": "stopRecording"],
            expecting: ["recordingStopped"],
            timeout: 10
        )
        guard let filePath = response["filePath"] as? String, filePath.isEmpty == false else {
            throw FieldTheoryHelperBridgeError.invalidResponse("Helper returned no stop recording file path.")
        }
        return URL(fileURLWithPath: filePath, isDirectory: false)
    }

    func cancelRecording() throws {
        _ = try bridge.request(
            ["type": "cancelRecording"],
            expecting: ["recordingCancelled"],
            timeout: 2
        )
        chunkQueue.sync {
            readyChunks.removeAll(keepingCapacity: true)
        }
    }

    func snapshotRecording() throws -> URL {
        let response = try bridge.request(
            ["type": "snapshotRecording"],
            expecting: ["recordingSnapshot"],
            timeout: 2
        )
        guard let filePath = response["filePath"] as? String, filePath.isEmpty == false else {
            throw FieldTheoryHelperBridgeError.invalidResponse("Helper returned no snapshot file path.")
        }
        return URL(fileURLWithPath: filePath, isDirectory: false)
    }

    func setHarvestMode(_ mode: RecordingHarvestMode) throws {
        try bridge.send(["type": "setHarvestMode", "mode": mode.rawValue])
    }

    func drainReadyChunks() -> [URL] {
        chunkQueue.sync {
            let output = readyChunks
            readyChunks.removeAll(keepingCapacity: true)
            return output
        }
    }

    private func appendReadyChunk(_ url: URL) {
        chunkQueue.sync {
            readyChunks.append(url)
        }
    }
}
