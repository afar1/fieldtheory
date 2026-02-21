import Foundation
import XCTest
@testable import FieldTheoryNativeApp

final class QwenServerClientTests: XCTestCase {
    private var tempRoot: URL!

    override func setUpWithError() throws {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("field-theory-native-qwen-client-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        tempRoot = base
    }

    override func tearDownWithError() throws {
        if let tempRoot {
            try? FileManager.default.removeItem(at: tempRoot)
        }
    }

    func testClientPersistsServerAcrossRequests() throws {
        guard let pythonURL = resolvedPythonURL() else {
            throw XCTSkip("Python executable unavailable on test runner.")
        }

        let scriptURL = try writeServerScript(
            """
            import json
            import sys

            count = 0

            def send(obj):
                print(json.dumps(obj), flush=True)

            send({"ok": True, "ready": True})

            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                cmd = json.loads(line)
                if cmd.get("cmd") == "transcribe":
                    count += 1
                    send({"ok": True, "text": f"chunk-{count}"})
                else:
                    send({"ok": False, "error": "unknown command"})
            """
        )

        let client = QwenServerClient()
        defer { client.stop() }

        let dummyAudioURL = tempRoot.appendingPathComponent("dummy.wav", isDirectory: false)
        try Data("wav".utf8).write(to: dummyAudioURL)

        let first = try client.transcribe(
            audioURL: dummyAudioURL,
            pythonURL: pythonURL,
            scriptURL: scriptURL,
            timeout: 5
        )
        let second = try client.transcribe(
            audioURL: dummyAudioURL,
            pythonURL: pythonURL,
            scriptURL: scriptURL,
            timeout: 5
        )

        XCTAssertEqual(first, "chunk-1")
        XCTAssertEqual(second, "chunk-2")
    }

    func testClientSurfacesCommandFailures() throws {
        guard let pythonURL = resolvedPythonURL() else {
            throw XCTSkip("Python executable unavailable on test runner.")
        }

        let scriptURL = try writeServerScript(
            """
            import json
            import sys

            def send(obj):
                print(json.dumps(obj), flush=True)

            send({"ok": True, "ready": True})

            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                send({"ok": False, "error": "forced failure"})
            """
        )

        let client = QwenServerClient()
        defer { client.stop() }

        let dummyAudioURL = tempRoot.appendingPathComponent("dummy.wav", isDirectory: false)
        try Data("wav".utf8).write(to: dummyAudioURL)

        XCTAssertThrowsError(
            try client.transcribe(
                audioURL: dummyAudioURL,
                pythonURL: pythonURL,
                scriptURL: scriptURL,
                timeout: 5
            )
        ) { error in
            XCTAssertTrue(error.localizedDescription.contains("forced failure"))
        }
    }

    private func resolvedPythonURL() -> URL? {
        let candidates = [
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
            "/usr/bin/python3",
        ].map { URL(fileURLWithPath: $0, isDirectory: false) }

        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate.path) {
            return candidate
        }

        return nil
    }

    private func writeServerScript(_ source: String) throws -> URL {
        let scriptURL = tempRoot.appendingPathComponent("fake-qwen-server.py", isDirectory: false)
        try Data(source.utf8).write(to: scriptURL)
        return scriptURL
    }
}
