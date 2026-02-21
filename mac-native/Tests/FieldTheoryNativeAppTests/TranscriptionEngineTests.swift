import Foundation
import XCTest
@testable import FieldTheoryNativeApp

final class TranscriptionEngineTests: XCTestCase {
    private var tempRoot: URL!
    private var supportRoot: URL!

    override func setUpWithError() throws {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("field-theory-native-engine-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        tempRoot = base
        supportRoot = base.appendingPathComponent("Application Support", isDirectory: true)
        try FileManager.default.createDirectory(at: supportRoot, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let tempRoot {
            try? FileManager.default.removeItem(at: tempRoot)
        }
    }

    func testWhisperParserStripsMetadataNoise() {
        let output = """
        main: processing
        [00:00:00.000 --> 00:00:01.000] hello world
        [00:00:01.000 --> 00:00:02.000] this is field theory
        system_info: done
        """

        let parsed = WhisperCLITranscriptionEngine.parseWhisperOutput(output)
        XCTAssertEqual(parsed, "hello world this is field theory")
    }

    @MainActor
    func testServiceFallsBackWhenSelectedEngineUnavailable() throws {
        let paths = DataPaths.make(supportRoot: supportRoot)
        let safetyManager = DataSafetyManager(policy: .strict, paths: paths)
        try safetyManager.ensureSafeFilesystemLayout()

        let whisper = FakeEngine(kind: .whisper, available: true, output: "from whisper")
        let qwen = FakeEngine(kind: .qwen, available: false, output: "from qwen")

        let service = DefaultTranscriptionService(
            safetyManager: safetyManager,
            recorder: FakeRecorder(),
            modelLocator: FakeModelLocator(),
            engines: [whisper, qwen]
        )

        service.setSelectedEngine(.qwen)
        service.startRecording()
        let text = service.stopRecording()

        XCTAssertEqual(text, "from whisper")
        XCTAssertEqual(service.selectedEngine, .whisper)
    }

    @MainActor
    func testServicePersistsHelperOutputIntoNativeRecordingDirectory() throws {
        let paths = DataPaths.make(supportRoot: supportRoot)
        let safetyManager = DataSafetyManager(policy: .strict, paths: paths)
        try safetyManager.ensureSafeFilesystemLayout()

        let helperOutputURL = tempRoot.appendingPathComponent("helper-output.wav", isDirectory: false)
        try Data("wav".utf8).write(to: helperOutputURL)

        let recorder = FakeRecorder(
            backend: .helper,
            stopURL: helperOutputURL
        )

        var transcribedURL: URL?
        let whisper = FakeEngine(
            kind: .whisper,
            available: true,
            output: "copied",
            onTranscribe: { url in
                transcribedURL = url
            }
        )

        let service = DefaultTranscriptionService(
            safetyManager: safetyManager,
            recorder: recorder,
            modelLocator: FakeModelLocator(),
            engines: [whisper],
            diagnosticsProvider: TranscriptionDiagnosticsProvider(processRunner: FakeProcessRunner())
        )

        service.startRecording()
        let text = service.stopRecording()

        XCTAssertEqual(text, "copied")
        XCTAssertEqual(service.recordingBackend, .helper)
        XCTAssertNotNil(transcribedURL)
        XCTAssertTrue(transcribedURL?.path.contains(paths.recordingsRoot.path) == true)
        XCTAssertTrue(FileManager.default.fileExists(atPath: transcribedURL?.path ?? ""))
        XCTAssertTrue(FileManager.default.fileExists(atPath: helperOutputURL.path))
    }

    @MainActor
    func testSnapshotRecordingTranscribesChunkWithoutEndingSession() throws {
        let paths = DataPaths.make(supportRoot: supportRoot)
        let safetyManager = DataSafetyManager(policy: .strict, paths: paths)
        try safetyManager.ensureSafeFilesystemLayout()

        let snapshotURL = tempRoot.appendingPathComponent("snapshot.wav", isDirectory: false)
        try Data("wav".utf8).write(to: snapshotURL)

        let recorder = FakeRecorder(
            backend: .helper,
            supportsSnapshots: true,
            stopURL: tempRoot.appendingPathComponent("stop.wav", isDirectory: false),
            snapshotURL: snapshotURL
        )

        let whisper = FakeEngine(kind: .whisper, available: true, output: "snapshot text")

        let service = DefaultTranscriptionService(
            safetyManager: safetyManager,
            recorder: recorder,
            modelLocator: FakeModelLocator(),
            engines: [whisper],
            diagnosticsProvider: TranscriptionDiagnosticsProvider(processRunner: FakeProcessRunner())
        )

        service.startRecording()
        let snapshot = service.snapshotRecording()

        XCTAssertEqual(snapshot, "snapshot text")
        XCTAssertEqual(service.state, .recording)
        XCTAssertEqual(service.supportsRecordingSnapshots, true)
    }

    @MainActor
    func testCancelRecordingReturnsServiceToIdle() throws {
        let paths = DataPaths.make(supportRoot: supportRoot)
        let safetyManager = DataSafetyManager(policy: .strict, paths: paths)
        try safetyManager.ensureSafeFilesystemLayout()

        let recorder = FakeRecorder(backend: .helper, supportsSnapshots: true)
        let whisper = FakeEngine(kind: .whisper, available: true, output: "ignored")

        let service = DefaultTranscriptionService(
            safetyManager: safetyManager,
            recorder: recorder,
            modelLocator: FakeModelLocator(),
            engines: [whisper],
            diagnosticsProvider: TranscriptionDiagnosticsProvider(processRunner: FakeProcessRunner())
        )

        service.startRecording()
        service.cancelRecording()

        XCTAssertEqual(service.state, .idle)
    }

    @MainActor
    func testHelperBackendUsesCommandHarvestMode() throws {
        let paths = DataPaths.make(supportRoot: supportRoot)
        let safetyManager = DataSafetyManager(policy: .strict, paths: paths)
        try safetyManager.ensureSafeFilesystemLayout()

        let recorder = FakeRecorder(backend: .helper)
        let whisper = FakeEngine(kind: .whisper, available: true, output: "ok")

        let service = DefaultTranscriptionService(
            safetyManager: safetyManager,
            recorder: recorder,
            modelLocator: FakeModelLocator(),
            engines: [whisper],
            diagnosticsProvider: TranscriptionDiagnosticsProvider(processRunner: FakeProcessRunner())
        )

        service.startRecording()
        XCTAssertEqual(recorder.harvestModes.first, .command)
    }

    @MainActor
    func testStopRecordingIncludesChunksDrainedAfterStop() throws {
        let paths = DataPaths.make(supportRoot: supportRoot)
        let safetyManager = DataSafetyManager(policy: .strict, paths: paths)
        try safetyManager.ensureSafeFilesystemLayout()

        let chunkOne = tempRoot.appendingPathComponent("chunk-one.wav", isDirectory: false)
        let chunkTwo = tempRoot.appendingPathComponent("chunk-two.wav", isDirectory: false)
        let stopURL = tempRoot.appendingPathComponent("stop.wav", isDirectory: false)
        try Data("wav".utf8).write(to: chunkOne)
        try Data("wav".utf8).write(to: chunkTwo)
        try Data("wav".utf8).write(to: stopURL)

        let recorder = FakeRecorder(
            backend: .helper,
            stopURL: stopURL,
            drainSequences: [[chunkOne], [chunkTwo]]
        )

        var transcribedURLs: [URL] = []
        let whisper = FakeEngine(
            kind: .whisper,
            available: true,
            output: "ok",
            onTranscribe: { url in
                transcribedURLs.append(url)
            },
            transcribeResult: { _ in "ok" }
        )

        let service = DefaultTranscriptionService(
            safetyManager: safetyManager,
            recorder: recorder,
            modelLocator: FakeModelLocator(),
            engines: [whisper],
            diagnosticsProvider: TranscriptionDiagnosticsProvider(processRunner: FakeProcessRunner())
        )

        service.startRecording()
        let text = service.stopRecording()

        XCTAssertEqual(text, "ok ok ok")
        XCTAssertEqual(transcribedURLs.count, 3)
        XCTAssertTrue(transcribedURLs.allSatisfy { $0.path.contains(paths.recordingsRoot.path) })
    }

    func testQwenDiagnosticReportsMissingDependencyWithSetupGuidance() {
        let modelLocator = DiagnosticsModelLocator(
            whisperBinary: nil,
            whisperModel: nil,
            qwenScript: URL(fileURLWithPath: "/tmp/qwen-transcribe.py"),
            pythonPath: URL(fileURLWithPath: "/usr/bin/python3"),
            helperPath: nil
        )

        let provider = TranscriptionDiagnosticsProvider(
            processRunner: FakeProcessRunner(
                result: ProcessExecutionResult(
                    terminationStatus: 1,
                    stdout: "",
                    stderr: "No module named mlx_audio"
                )
            )
        )

        let context = TranscriptionContext(dataPaths: DataPaths.make(supportRoot: supportRoot), modelLocator: modelLocator)
        let diagnostics = provider.diagnostics(context: context, availableEngines: [.whisper])
        let qwen = diagnostics.first(where: { $0.engine == .qwen })

        XCTAssertEqual(qwen?.available, false)
        XCTAssertTrue(qwen?.message.contains("setup-qwen.sh") == true)
    }

    func testQwenDiagnosticReadyWhenImportSucceeds() {
        let modelLocator = DiagnosticsModelLocator(
            whisperBinary: nil,
            whisperModel: nil,
            qwenScript: URL(fileURLWithPath: "/tmp/qwen-transcribe.py"),
            pythonPath: URL(fileURLWithPath: "/usr/bin/python3"),
            helperPath: nil
        )

        let provider = TranscriptionDiagnosticsProvider(
            processRunner: FakeProcessRunner(
                result: ProcessExecutionResult(
                    terminationStatus: 0,
                    stdout: "",
                    stderr: ""
                )
            )
        )

        let context = TranscriptionContext(dataPaths: DataPaths.make(supportRoot: supportRoot), modelLocator: modelLocator)
        let diagnostics = provider.diagnostics(context: context, availableEngines: [.qwen])
        let qwen = diagnostics.first(where: { $0.engine == .qwen })

        XCTAssertEqual(qwen?.available, true)
        XCTAssertTrue(qwen?.message.contains("Qwen ready") == true)
    }
}

private final class FakeRecorder: RecordingController {
    let backend: TranscriptionRecordingBackendKind
    let supportsSnapshots: Bool
    private(set) var harvestModes: [RecordingHarvestMode] = []
    private let stopURL: URL?
    private let snapshotURL: URL?
    private var drainSequences: [[URL]]
    private var drainIndex = 0
    private var activePreferredURL: URL?

    init(
        backend: TranscriptionRecordingBackendKind = .avAudioRecorder,
        supportsSnapshots: Bool = false,
        stopURL: URL? = nil,
        snapshotURL: URL? = nil,
        chunkURLs: [URL] = [],
        drainSequences: [[URL]] = []
    ) {
        self.backend = backend
        self.supportsSnapshots = supportsSnapshots
        self.stopURL = stopURL
        self.snapshotURL = snapshotURL
        if drainSequences.isEmpty {
            self.drainSequences = chunkURLs.isEmpty ? [] : [chunkURLs]
        } else {
            self.drainSequences = drainSequences
        }
    }

    func startRecording(preferredOutputURL url: URL) throws {
        activePreferredURL = url
        if stopURL == nil {
            try Data("wav".utf8).write(to: url)
        }
    }

    func stopRecording() throws -> URL {
        if let stopURL {
            return stopURL
        }
        guard let activePreferredURL else {
            throw TranscriptionEngineError.recordingFailed("No active preferred URL.")
        }
        return activePreferredURL
    }

    func cancelRecording() throws {}

    func snapshotRecording() throws -> URL {
        guard let snapshotURL else {
            throw TranscriptionEngineError.recordingFailed("Snapshot unsupported in fake recorder.")
        }
        return snapshotURL
    }

    func setHarvestMode(_ mode: RecordingHarvestMode) throws {
        harvestModes.append(mode)
    }

    func drainReadyChunks() -> [URL] {
        guard drainIndex < drainSequences.count else {
            return []
        }
        let output = drainSequences[drainIndex]
        drainIndex += 1
        return output
    }
}

private struct FakeModelLocator: ModelLocator {
    func whisperBinaryURL() -> URL? { nil }
    func whisperModelURL() -> URL? { nil }
    func qwenScriptURL() -> URL? { nil }
    func pythonExecutableURL() -> URL? { nil }
    func helperBinaryURL() -> URL? { nil }
}

private struct FakeEngine: TranscriptionEngine {
    let kind: TranscriptionEngineKind
    let available: Bool
    let output: String
    let onTranscribe: ((URL) -> Void)?
    let transcribeResult: ((URL) throws -> String)?

    init(
        kind: TranscriptionEngineKind,
        available: Bool,
        output: String,
        onTranscribe: ((URL) -> Void)? = nil,
        transcribeResult: ((URL) throws -> String)? = nil
    ) {
        self.kind = kind
        self.available = available
        self.output = output
        self.onTranscribe = onTranscribe
        self.transcribeResult = transcribeResult
    }

    func isAvailable(context: TranscriptionContext) -> Bool {
        available
    }

    func transcribe(audioURL: URL, context: TranscriptionContext) throws -> String {
        onTranscribe?(audioURL)
        if let transcribeResult {
            return try transcribeResult(audioURL)
        }
        return output
    }
}

private struct DiagnosticsModelLocator: ModelLocator {
    let whisperBinary: URL?
    let whisperModel: URL?
    let qwenScript: URL?
    let pythonPath: URL?
    let helperPath: URL?

    func whisperBinaryURL() -> URL? { whisperBinary }
    func whisperModelURL() -> URL? { whisperModel }
    func qwenScriptURL() -> URL? { qwenScript }
    func pythonExecutableURL() -> URL? { pythonPath }
    func helperBinaryURL() -> URL? { helperPath }
}

private struct FakeProcessRunner: ProcessRunner {
    let result: ProcessExecutionResult

    init(
        result: ProcessExecutionResult = ProcessExecutionResult(
            terminationStatus: 0,
            stdout: "",
            stderr: ""
        )
    ) {
        self.result = result
    }

    func run(executableURL: URL, arguments: [String], timeout: TimeInterval) throws -> ProcessExecutionResult {
        _ = executableURL
        _ = arguments
        _ = timeout
        return result
    }
}
