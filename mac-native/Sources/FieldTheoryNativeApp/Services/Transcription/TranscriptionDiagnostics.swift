import Foundation

struct ProcessExecutionResult {
    let terminationStatus: Int32
    let stdout: String
    let stderr: String
}

protocol ProcessRunner: Sendable {
    func run(executableURL: URL, arguments: [String], timeout: TimeInterval) throws -> ProcessExecutionResult
}

struct DefaultProcessRunner: ProcessRunner {
    func run(executableURL: URL, arguments: [String], timeout: TimeInterval) throws -> ProcessExecutionResult {
        let process = Process()
        process.executableURL = executableURL
        process.arguments = arguments

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        let completion = DispatchGroup()
        completion.enter()
        process.terminationHandler = { _ in
            completion.leave()
        }

        try process.run()
        let waitResult = completion.wait(timeout: .now() + timeout)
        if waitResult == .timedOut {
            process.terminate()
            throw TranscriptionEngineError.processFailed("Process timed out: \(executableURL.lastPathComponent)")
        }

        let stdout = String(data: stdoutPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let stderr = String(data: stderrPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""

        return ProcessExecutionResult(
            terminationStatus: process.terminationStatus,
            stdout: stdout,
            stderr: stderr
        )
    }
}

struct TranscriptionDiagnosticsProvider: Sendable {
    let processRunner: ProcessRunner

    init(processRunner: ProcessRunner = DefaultProcessRunner()) {
        self.processRunner = processRunner
    }

    func diagnostics(
        context: TranscriptionContext,
        availableEngines: [TranscriptionEngineKind]
    ) -> [TranscriptionEngineDiagnostic] {
        let availableSet = Set(availableEngines)
        return [
            whisperDiagnostic(context: context, availableSet: availableSet),
            qwenDiagnostic(context: context, availableSet: availableSet),
        ]
    }

    private func whisperDiagnostic(
        context: TranscriptionContext,
        availableSet: Set<TranscriptionEngineKind>
    ) -> TranscriptionEngineDiagnostic {
        let binaryFound = context.modelLocator.whisperBinaryURL() != nil
        let modelFound = context.modelLocator.whisperModelURL() != nil

        let message: String
        if binaryFound && modelFound {
            message = "Whisper ready (local binary + model available)."
        } else if binaryFound == false && modelFound == false {
            message = "Whisper unavailable: missing whisper-cli binary and model."
        } else if binaryFound == false {
            message = "Whisper unavailable: whisper-cli binary not found."
        } else {
            message = "Whisper unavailable: model file not found."
        }

        return TranscriptionEngineDiagnostic(
            engine: .whisper,
            available: availableSet.contains(.whisper),
            message: message
        )
    }

    private func qwenDiagnostic(
        context: TranscriptionContext,
        availableSet: Set<TranscriptionEngineKind>
    ) -> TranscriptionEngineDiagnostic {
        guard let pythonPath = context.modelLocator.pythonExecutableURL() else {
            return TranscriptionEngineDiagnostic(
                engine: .qwen,
                available: false,
                message: "Qwen unavailable: python executable not found."
            )
        }

        guard context.modelLocator.qwenScriptURL() != nil else {
            return TranscriptionEngineDiagnostic(
                engine: .qwen,
                available: false,
                message: "Qwen unavailable: qwen-transcribe.py not found."
            )
        }

        do {
            let result = try processRunner.run(
                executableURL: pythonPath,
                arguments: ["-c", "import mlx_audio"],
                timeout: 6
            )
            if result.terminationStatus == 0 {
                return TranscriptionEngineDiagnostic(
                    engine: .qwen,
                    available: availableSet.contains(.qwen),
                    message: "Qwen ready (\(pythonPath.lastPathComponent) + mlx-audio import succeeded)."
                )
            }

            let stderr = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            return TranscriptionEngineDiagnostic(
                engine: .qwen,
                available: false,
                message: "Qwen unavailable: mlx-audio missing. Run `cd mac-app && bash scripts/setup-qwen.sh`. \(stderr)"
            )
        } catch {
            return TranscriptionEngineDiagnostic(
                engine: .qwen,
                available: false,
                message: "Qwen unavailable: failed environment check (\(error.localizedDescription))."
            )
        }
    }
}
