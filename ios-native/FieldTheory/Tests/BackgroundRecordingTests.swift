import XCTest
import AVFoundation
import FluidAudio
@testable import FieldTheory

@MainActor
final class BackgroundRecordingTests: XCTestCase {
    func testNegotiatedCaptureRatesConvertForTranscription() throws {
        for rate in [24_000.0, 48_000.0] {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("capture-\(UUID()).wav")
            defer { try? FileManager.default.removeItem(at: url) }
            let settings = try RecorderController.captureSettings(sampleRate: rate)
            do {
                let file = try AVAudioFile(forWriting: url, settings: settings)
                let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(rate)))
                buffer.frameLength = buffer.frameCapacity
                let samples = try XCTUnwrap(buffer.floatChannelData)[0]
                for index in 0..<Int(buffer.frameLength) {
                    samples[index] = Float(sin(2 * Double.pi * 440 * Double(index) / rate) * 0.25)
                }
                try file.write(from: buffer)
            }
            let recorded = try AVAudioFile(forReading: url)
            XCTAssertEqual(recorded.processingFormat.sampleRate, rate)
            let converted = try AudioSourceFactory().makeDiskBackedSource(from: url, targetSampleRate: 16_000).source
            defer { converted.cleanup() }
            XCTAssertEqual(Double(converted.sampleCount), 16_000, accuracy: 32)
        }
        for invalid in [0.0, -1.0, Double.nan, Double.infinity] {
            XCTAssertThrowsError(try RecorderController.captureSettings(sampleRate: invalid))
        }
    }

    func testPreparationFailureKeepsItsDistinctErrorAfterBoundedRetries() async {
        var attempts = 0
        do {
            try await RecorderController.startMicrophoneWithRetry {
                attempts += 1
                throw MicrophoneStartError.preparationFailed
            } wait: { _ in }
            XCTFail("Must report preparation failure")
        } catch MicrophoneStartError.preparationFailed {} catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertEqual(attempts, 4)
    }

    func testMicrophoneRetryRecoversAndStopsAfterSuccess() async throws {
        var attempts = 0
        var delays: [Duration] = []
        try await RecorderController.startMicrophoneWithRetry {
            attempts += 1
            if attempts < 3 { throw MicrophoneStartError.notStarted }
        } wait: { delays.append($0) }
        XCTAssertEqual(attempts, 3)
        XCTAssertEqual(delays, [.milliseconds(250), .milliseconds(500)])
    }

    func testMicrophoneRetryIsBounded() async throws {
        var attempts = 0
        var waits = 0
        do {
            try await RecorderController.startMicrophoneWithRetry {
                attempts += 1
                throw MicrophoneStartError.notStarted
            } wait: { _ in waits += 1 }
            XCTFail("Must report exhaustion")
        } catch MicrophoneStartError.notStarted {} catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertEqual(attempts, 4)
        XCTAssertEqual(waits, 3)
    }

    func testMicrophoneRetryDoesNotRetryOtherFailures() async throws {
        var attempts = 0
        do {
            try await RecorderController.startMicrophoneWithRetry {
                attempts += 1
                throw CocoaError(.fileWriteNoPermission)
            } wait: { _ in XCTFail("Must not retry file or permission failures") }
            XCTFail("Must propagate failure")
        } catch {}
        XCTAssertEqual(attempts, 1)
    }

    func testMicrophoneRetryHonorsCancellationDuringWait() async throws {
        var attempts = 0
        do {
            try await RecorderController.startMicrophoneWithRetry {
                attempts += 1
                throw MicrophoneStartError.notStarted
            } wait: { _ in throw CancellationError() }
            XCTFail("Must propagate cancellation")
        } catch is CancellationError {} catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertEqual(attempts, 1)
    }

    func testLegacyCopyMigratesToStopAndSurvivesFailedDeliveryUntilRetry() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let suite = "StopChoiceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(["100": "copy"], forKey: "ft-recording-finish-actions")
        try Data("audio fixture".utf8).write(to: root.appendingPathComponent("rec-100-0.wav"))
        let recorder = RecorderController(pendingDirectory: root, defaults: defaults, transcribe: { _ in "test transcript" })
        var accept = false
        recorder.onTranscript = { _ in
            XCTAssertEqual(recorder.finishAction(for: recorder.currentDeliverySessionID), .stop)
            return accept
        }
        recorder.setWorkEnabled(true)
        await recorder.drainPendingQueue()
        XCTAssertEqual(recorder.pendingSessionCount, 1)
        XCTAssertEqual(recorder.finishAction(for: "100"), .stop)
        recorder.setFinishAction(.send, expectedID: "100")
        XCTAssertEqual(recorder.finishAction(for: "100"), .stop, "An idle/stale action cannot change a queued recording's choice")
        accept = true
        await recorder.drainPendingQueue()
        XCTAssertEqual(recorder.pendingSessionCount, 0)
        XCTAssertNil(recorder.finishAction(for: "100"))
    }

    func testIntentStartRejectsDisabledRecorderWithoutActivatingMicrophone() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let recorder = RecorderController(pendingDirectory: root, transcribe: { _ in "test" })
        do {
            try await recorder.startFromIntent()
            XCTFail("Disabled recorder must reject startup")
        } catch {}
        XCTAssertEqual(recorder.phase, .idle)
        XCTAssertNil(recorder.startedAt)
    }

    func testTranscriptPersistenceWorksWithoutCreatingRootViewAndSurvivesRecorderSwap() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let suite = "BackgroundRecordingTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let recorder = RecorderController(pendingDirectory: root.appendingPathComponent("audio"),
            defaults: defaults, transcribe: { _ in "test" })
        let model = AppModel(databasePathOverride: root.appendingPathComponent("db.sqlite").path,
            libraryRootOverride: root.appendingPathComponent("library"),
            reviewerDemoDatabasePathOverride: root.appendingPathComponent("demo.sqlite").path,
            reviewerDemoRootOverride: root.appendingPathComponent("demo"),
            recorderOverride: recorder, startInitialPreparation: false)
        model.auth.onPhaseChange = nil
        XCTAssertNotNil(recorder.onTranscript, "Cold launch must wire persistence before a scene appears")
        try await model.enterReviewerDemo { _, _, _, _ in }
        XCTAssertFalse(model.recorder === recorder)
        let save = try XCTUnwrap(model.recorder.onTranscript)
        let saved = await save("spoken without opening a screen")
        XCTAssertTrue(saved)
        XCTAssertEqual(model.transcripts.items.map(\.text), ["spoken without opening a screen"])
        let staleSave = try XCTUnwrap(recorder.onTranscript)
        let staleAccepted = await staleSave("old workspace")
        XCTAssertFalse(staleAccepted)
    }
}
