import AVFoundation
import Foundation

enum RecordingHarvestMode: String {
    case off
    case command
    case dictation
}

protocol RecordingController {
    var backend: TranscriptionRecordingBackendKind { get }
    var supportsSnapshots: Bool { get }
    func startRecording(preferredOutputURL url: URL) throws
    func stopRecording() throws -> URL
    func cancelRecording() throws
    func snapshotRecording() throws -> URL
    func setHarvestMode(_ mode: RecordingHarvestMode) throws
    func drainReadyChunks() -> [URL]
}

final class AVAudioRecordingController: NSObject, RecordingController {
    private var recorder: AVAudioRecorder?
    private var activeURL: URL?

    let backend: TranscriptionRecordingBackendKind = .avAudioRecorder
    let supportsSnapshots: Bool = false

    func startRecording(preferredOutputURL url: URL) throws {
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsFloatKey: false,
        ]

        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.prepareToRecord()
        guard recorder.record() else {
            throw TranscriptionEngineError.recordingFailed("AVAudioRecorder failed to start.")
        }
        self.recorder = recorder
        self.activeURL = url
    }

    func stopRecording() throws -> URL {
        guard let activeURL else {
            throw TranscriptionEngineError.recordingFailed("No active recording file.")
        }
        recorder?.stop()
        recorder = nil
        self.activeURL = nil
        return activeURL
    }

    func cancelRecording() throws {
        recorder?.stop()
        recorder = nil
        activeURL = nil
    }

    func snapshotRecording() throws -> URL {
        throw TranscriptionEngineError.recordingFailed("Snapshot recording is unsupported for AVAudioRecorder backend.")
    }

    func setHarvestMode(_ mode: RecordingHarvestMode) throws {
        _ = mode
    }

    func drainReadyChunks() -> [URL] {
        []
    }
}

struct TranscriptionContext: @unchecked Sendable {
    let dataPaths: DataPaths
    let modelLocator: ModelLocator
}

protocol TranscriptionEngine {
    var kind: TranscriptionEngineKind { get }
    func isAvailable(context: TranscriptionContext) -> Bool
    func transcribe(audioURL: URL, context: TranscriptionContext) throws -> String
}

protocol ModelLocator: Sendable {
    func whisperBinaryURL() -> URL?
    func whisperModelURL() -> URL?
    func qwenScriptURL() -> URL?
    func pythonExecutableURL() -> URL?
    func helperBinaryURL() -> URL?
}

struct DefaultModelLocator: @unchecked Sendable, ModelLocator {
    let paths: DataPaths
    let environment: [String: String]
    let fileManager: FileManager

    init(
        paths: DataPaths,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) {
        self.paths = paths
        self.environment = environment
        self.fileManager = fileManager
    }

    func whisperBinaryURL() -> URL? {
        if let envPath = environment["FIELD_THEORY_WHISPER_PATH"] {
            let url = URL(fileURLWithPath: envPath, isDirectory: false)
            if fileManager.isExecutableFile(atPath: url.path) {
                return url
            }
        }

        return findFileUpTree(relativePath: "build-whisper/bin/whisper-cli", executable: true)
    }

    func whisperModelURL() -> URL? {
        if let envPath = environment["FIELD_THEORY_WHISPER_MODEL"] {
            let url = URL(fileURLWithPath: envPath, isDirectory: false)
            if fileManager.fileExists(atPath: url.path) {
                return url
            }
        }

        let preferredModels = [
            "ggml-small.en.bin",
            "ggml-medium.en.bin",
            "ggml-base.en.bin",
        ]

        let legacyRoots: [URL]
        if let primaryLegacyRoot = paths.primaryLegacyRoot {
            legacyRoots = [primaryLegacyRoot] + paths.legacyRoots.filter { $0 != primaryLegacyRoot }
        } else {
            legacyRoots = paths.legacyRoots
        }

        for root in legacyRoots {
            for modelName in preferredModels {
                let candidate = root
                    .appendingPathComponent("models", isDirectory: true)
                    .appendingPathComponent(modelName, isDirectory: false)
                if fileManager.fileExists(atPath: candidate.path) {
                    return candidate
                }
            }
        }

        return findFileUpTree(relativePath: "models/for-tests-ggml-small.en.bin", executable: false)
    }

    func qwenScriptURL() -> URL? {
        if let envPath = environment["FIELD_THEORY_QWEN_SCRIPT"] {
            let url = URL(fileURLWithPath: envPath, isDirectory: false)
            if fileManager.fileExists(atPath: url.path) {
                return url
            }
        }

        return findFileUpTree(relativePath: "mac-app/scripts/qwen-transcribe.py", executable: false)
    }

    func pythonExecutableURL() -> URL? {
        if let envPath = environment["FIELD_THEORY_PYTHON_PATH"] {
            let url = URL(fileURLWithPath: envPath, isDirectory: false)
            if fileManager.isExecutableFile(atPath: url.path) {
                return url
            }
        }

        if let qwenVenv = findFileUpTree(relativePath: "mac-app/build-qwen/venv/bin/python", executable: true) {
            return qwenVenv
        }

        let candidates = [
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
            "/usr/bin/python3",
        ].map { URL(fileURLWithPath: $0, isDirectory: false) }

        for candidate in candidates where fileManager.isExecutableFile(atPath: candidate.path) {
            return candidate
        }

        return nil
    }

    func helperBinaryURL() -> URL? {
        if let envPath = environment["FIELD_THEORY_HELPER_PATH"] {
            let url = URL(fileURLWithPath: envPath, isDirectory: false)
            if fileManager.isExecutableFile(atPath: url.path) {
                return url
            }
        }

        return findFileUpTree(relativePath: "mac-app/electron/native/build/FieldTheoryHelper", executable: true)
    }

    private func findFileUpTree(relativePath: String, executable: Bool) -> URL? {
        let start = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
        var cursor: URL? = start
        var depth = 0
        let maxDepth = 8

        while let current = cursor, depth <= maxDepth {
            let candidate = current.appendingPathComponent(relativePath, isDirectory: false)
            if executable {
                if fileManager.isExecutableFile(atPath: candidate.path) {
                    return candidate
                }
            } else if fileManager.fileExists(atPath: candidate.path) {
                return candidate
            }

            let parent = current.deletingLastPathComponent()
            cursor = parent.path == current.path ? nil : parent
            depth += 1
        }

        return nil
    }
}

enum TranscriptionEngineError: LocalizedError {
    case binaryNotFound(String)
    case modelNotFound(String)
    case recordingFailed(String)
    case processFailed(String)
    case emptyTranscript(String)

    var errorDescription: String? {
        switch self {
        case .binaryNotFound(let message),
             .modelNotFound(let message),
             .recordingFailed(let message),
             .processFailed(let message),
             .emptyTranscript(let message):
            return message
        }
    }
}

struct WhisperCLITranscriptionEngine: TranscriptionEngine {
    let kind: TranscriptionEngineKind = .whisper

    func isAvailable(context: TranscriptionContext) -> Bool {
        context.modelLocator.whisperBinaryURL() != nil && context.modelLocator.whisperModelURL() != nil
    }

    func transcribe(audioURL: URL, context: TranscriptionContext) throws -> String {
        guard let whisperPath = context.modelLocator.whisperBinaryURL() else {
            throw TranscriptionEngineError.binaryNotFound("whisper-cli binary not found.")
        }
        guard let modelPath = context.modelLocator.whisperModelURL() else {
            throw TranscriptionEngineError.modelNotFound("Whisper model not found.")
        }

        do {
            return try runWhisper(
                whisperPath: whisperPath,
                modelPath: modelPath,
                wavPath: audioURL,
                disableGPU: false
            )
        } catch {
            let description = String(describing: error)
            if isMetalError(description) {
                return try runWhisper(
                    whisperPath: whisperPath,
                    modelPath: modelPath,
                    wavPath: audioURL,
                    disableGPU: true
                )
            }
            throw error
        }
    }

    private func runWhisper(
        whisperPath: URL,
        modelPath: URL,
        wavPath: URL,
        disableGPU: Bool
    ) throws -> String {
        let process = Process()
        process.executableURL = whisperPath

        var arguments = [
            "-m", modelPath.path,
            "-f", wavPath.path,
            "--language", "en",
            "--no-timestamps",
        ]
        if disableGPU {
            arguments.append("-ng")
        }
        process.arguments = arguments
        process.environment = ProcessInfo.processInfo.environment.merging(["NO_COLOR": "1"]) { existing, _ in existing }

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            throw TranscriptionEngineError.processFailed("Failed to launch whisper-cli: \(error.localizedDescription)")
        }

        let stderrText = String(data: stderrPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            throw TranscriptionEngineError.processFailed("whisper-cli exited with code \(process.terminationStatus): \(stderrText)")
        }

        let stdoutText = String(data: stdoutPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let transcript = Self.parseWhisperOutput(stdoutText)
        guard transcript.isEmpty == false else {
            throw TranscriptionEngineError.emptyTranscript("Whisper returned empty output.")
        }
        return transcript
    }

    private func isMetalError(_ message: String) -> Bool {
        message.contains("MTLLibraryError")
            || message.contains("MetalPerformancePrimitives")
            || message.contains("metal_library_compile_pipeline")
            || message.contains("ggml_metal")
    }

    static func parseWhisperOutput(_ output: String) -> String {
        let ansiEscapeRegex = try? NSRegularExpression(pattern: "\\u{001B}\\[[0-9;]*m", options: [])
        let fullRange = NSRange(location: 0, length: output.utf16.count)
        let stripped: String
        if let ansiEscapeRegex {
            stripped = ansiEscapeRegex.stringByReplacingMatches(in: output, options: [], range: fullRange, withTemplate: "")
        } else {
            stripped = output
        }

        let lines = stripped.split(separator: "\n")
        let textParts = lines.compactMap { rawLine -> String? in
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty {
                return nil
            }

            if line.contains("-->"), let bracket = line.lastIndex(of: "]") {
                let next = line.index(after: bracket)
                if next < line.endIndex {
                    let text = line[next...].trimmingCharacters(in: .whitespaces)
                    return text.isEmpty ? nil : text
                }
            }

            if line.hasPrefix("[") && line.hasSuffix("]") {
                return nil
            }
            if line.hasPrefix("whisper_") || line.hasPrefix("main:") || line.hasPrefix("system_info:") {
                return nil
            }

            return line
        }

        return textParts.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

enum QwenServerClientError: LocalizedError {
    case startupFailed(String)
    case commandFailed(String)
    case timedOut(String)
    case processExited(String)
    case invalidResponse(String)

    var errorDescription: String? {
        switch self {
        case .startupFailed(let message),
             .commandFailed(let message),
             .timedOut(let message),
             .processExited(let message),
             .invalidResponse(let message):
            return message
        }
    }
}

final class QwenServerClient: @unchecked Sendable {
    private final class StartupWaiter {
        let semaphore = DispatchSemaphore(value: 0)
        var error: Error?
    }

    private final class CommandWaiter {
        let semaphore = DispatchSemaphore(value: 0)
        var response: [String: Any]?
        var error: Error?
    }

    private let queue = DispatchQueue(label: "FieldTheoryNative.QwenServerClient")
    private var process: Process?
    private var stdinHandle: FileHandle?
    private var stdoutHandle: FileHandle?
    private var stderrHandle: FileHandle?
    private var stdoutBuffer = Data()
    private var ready = false
    private var runningPythonPath: String?
    private var runningScriptPath: String?
    private var startupWaiter: StartupWaiter?
    private var commandWaiter: CommandWaiter?

    deinit {
        stop()
    }

    func stop() {
        queue.sync {
            stopLocked()
        }
    }

    func transcribe(
        audioURL: URL,
        pythonURL: URL,
        scriptURL: URL,
        timeout: TimeInterval = 120
    ) throws -> String {
        try ensureServerReady(pythonURL: pythonURL, scriptURL: scriptURL)
        let response = try sendCommand(
            ["cmd": "transcribe", "audio": audioURL.path],
            timeout: timeout
        )

        let ok = response["ok"] as? Bool ?? false
        if ok == false {
            let message = response["error"] as? String ?? "Unknown Qwen server error."
            throw QwenServerClientError.commandFailed(message)
        }

        let transcript = (response["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard transcript.isEmpty == false else {
            throw TranscriptionEngineError.emptyTranscript("Qwen returned empty output.")
        }
        return transcript
    }

    private func ensureServerReady(pythonURL: URL, scriptURL: URL) throws {
        let alreadyReady = queue.sync {
            guard let process else { return false }
            return process.isRunning
                && ready
                && runningPythonPath == pythonURL.path
                && runningScriptPath == scriptURL.path
        }

        if alreadyReady {
            return
        }

        let waiter = StartupWaiter()
        try queue.sync {
            try startServerLocked(
                pythonURL: pythonURL,
                scriptURL: scriptURL,
                waiter: waiter
            )
        }

        let waitResult = waiter.semaphore.wait(timeout: .now() + 120)
        if waitResult == .timedOut {
            stop()
            throw QwenServerClientError.timedOut("Qwen server startup timed out.")
        }

        if let error = waiter.error {
            throw error
        }
    }

    private func sendCommand(
        _ payload: [String: Any],
        timeout: TimeInterval
    ) throws -> [String: Any] {
        let waiter = CommandWaiter()

        try queue.sync {
            guard let process, process.isRunning, ready else {
                throw QwenServerClientError.processExited("Qwen server is not running.")
            }
            guard commandWaiter == nil else {
                throw QwenServerClientError.commandFailed("Qwen command already in flight.")
            }
            commandWaiter = waiter
            try writeJSONLineLocked(payload)
        }

        let waitResult = waiter.semaphore.wait(timeout: .now() + timeout)
        if waitResult == .timedOut {
            queue.sync {
                if commandWaiter === waiter {
                    commandWaiter = nil
                }
            }
            throw QwenServerClientError.timedOut("Qwen transcription timed out.")
        }

        if let error = waiter.error {
            throw error
        }

        guard let response = waiter.response else {
            throw QwenServerClientError.invalidResponse("Qwen server returned no response.")
        }

        return response
    }

    private func startServerLocked(
        pythonURL: URL,
        scriptURL: URL,
        waiter: StartupWaiter
    ) throws {
        stopLocked()

        let process = Process()
        process.executableURL = pythonURL
        process.arguments = [
            scriptURL.path,
            "--server",
        ]

        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        do {
            try process.run()
        } catch {
            throw QwenServerClientError.startupFailed("Failed to launch Qwen server: \(error.localizedDescription)")
        }

        self.process = process
        stdinHandle = stdinPipe.fileHandleForWriting
        stdoutHandle = stdoutPipe.fileHandleForReading
        stderrHandle = stderrPipe.fileHandleForReading
        stdoutBuffer.removeAll(keepingCapacity: true)
        ready = false
        runningPythonPath = pythonURL.path
        runningScriptPath = scriptURL.path
        startupWaiter = waiter
        commandWaiter = nil

        stdoutHandle?.readabilityHandler = { [weak self] handle in
            guard let self else { return }
            let data = handle.availableData
            self.queue.sync {
                self.handleStdoutDataLocked(data)
            }
        }

        stderrHandle?.readabilityHandler = { _ in
            // stderr is surfaced indirectly via startup/command failures.
        }

        process.terminationHandler = { [weak self] process in
            guard let self else { return }
            self.queue.sync {
                self.handleProcessExitLocked(status: process.terminationStatus)
            }
        }
    }

    private func stopLocked() {
        stdoutHandle?.readabilityHandler = nil
        stderrHandle?.readabilityHandler = nil

        if let process, process.isRunning {
            process.terminate()
        }

        process = nil
        stdinHandle = nil
        stdoutHandle = nil
        stderrHandle = nil
        stdoutBuffer.removeAll(keepingCapacity: false)
        ready = false
        runningPythonPath = nil
        runningScriptPath = nil

        if let startupWaiter {
            startupWaiter.error = QwenServerClientError.processExited("Qwen server stopped.")
            startupWaiter.semaphore.signal()
            self.startupWaiter = nil
        }

        if let commandWaiter {
            commandWaiter.error = QwenServerClientError.processExited("Qwen server stopped.")
            commandWaiter.semaphore.signal()
            self.commandWaiter = nil
        }
    }

    private func handleProcessExitLocked(status: Int32) {
        stdoutHandle?.readabilityHandler = nil
        stderrHandle?.readabilityHandler = nil
        process = nil
        stdinHandle = nil
        stdoutHandle = nil
        stderrHandle = nil
        stdoutBuffer.removeAll(keepingCapacity: false)
        ready = false
        runningPythonPath = nil
        runningScriptPath = nil

        if let startupWaiter {
            startupWaiter.error = QwenServerClientError.processExited("Qwen server exited with code \(status) during startup.")
            startupWaiter.semaphore.signal()
            self.startupWaiter = nil
        }

        if let commandWaiter {
            commandWaiter.error = QwenServerClientError.processExited("Qwen server exited with code \(status).")
            commandWaiter.semaphore.signal()
            self.commandWaiter = nil
        }
    }

    private func writeJSONLineLocked(_ payload: [String: Any]) throws {
        guard let stdinHandle else {
            throw QwenServerClientError.processExited("Qwen server stdin unavailable.")
        }

        let encoded: Data
        do {
            encoded = try JSONSerialization.data(withJSONObject: payload, options: [])
        } catch {
            throw QwenServerClientError.invalidResponse("Failed to encode Qwen payload: \(error.localizedDescription)")
        }

        var line = encoded
        line.append(0x0A)
        stdinHandle.write(line)
    }

    private func handleStdoutDataLocked(_ data: Data) {
        guard data.isEmpty == false else { return }
        stdoutBuffer.append(data)

        while let newlineRange = stdoutBuffer.range(of: Data([0x0A])) {
            let lineData = stdoutBuffer.subdata(in: 0..<newlineRange.lowerBound)
            stdoutBuffer.removeSubrange(0..<newlineRange.upperBound)
            guard
                let line = String(data: lineData, encoding: .utf8)?
                    .trimmingCharacters(in: .whitespacesAndNewlines),
                line.isEmpty == false
            else {
                continue
            }
            handleStdoutLineLocked(line)
        }
    }

    private func handleStdoutLineLocked(_ line: String) {
        guard
            let data = line.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data, options: []),
            let payload = object as? [String: Any]
        else {
            return
        }

        if let startupWaiter {
            if payload["ready"] as? Bool == true {
                ready = true
                startupWaiter.semaphore.signal()
                self.startupWaiter = nil
                return
            }

            if let ok = payload["ok"] as? Bool, ok == false {
                let error = payload["error"] as? String ?? "Qwen startup failed."
                startupWaiter.error = QwenServerClientError.startupFailed(error)
                startupWaiter.semaphore.signal()
                self.startupWaiter = nil
                return
            }
        }

        guard let commandWaiter else { return }
        if payload["ok"] != nil {
            commandWaiter.response = payload
            commandWaiter.semaphore.signal()
            self.commandWaiter = nil
        }
    }
}

final class QwenScriptTranscriptionEngine: @unchecked Sendable, TranscriptionEngine {
    let kind: TranscriptionEngineKind = .qwen
    private let serverClient: QwenServerClient

    init(serverClient: QwenServerClient = QwenServerClient()) {
        self.serverClient = serverClient
    }

    func isAvailable(context: TranscriptionContext) -> Bool {
        context.modelLocator.qwenScriptURL() != nil && context.modelLocator.pythonExecutableURL() != nil
    }

    func transcribe(audioURL: URL, context: TranscriptionContext) throws -> String {
        guard let pythonPath = context.modelLocator.pythonExecutableURL() else {
            throw TranscriptionEngineError.binaryNotFound("python3 executable not found for Qwen.")
        }
        guard let scriptPath = context.modelLocator.qwenScriptURL() else {
            throw TranscriptionEngineError.binaryNotFound("qwen-transcribe.py not found.")
        }

        do {
            return try serverClient.transcribe(
                audioURL: audioURL,
                pythonURL: pythonPath,
                scriptURL: scriptPath
            )
        } catch {
            // One retry after explicit restart to match Electron behavior.
            serverClient.stop()
            return try serverClient.transcribe(
                audioURL: audioURL,
                pythonURL: pythonPath,
                scriptURL: scriptPath
            )
        }
    }
}
