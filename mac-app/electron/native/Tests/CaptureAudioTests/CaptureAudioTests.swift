import XCTest
import AVFoundation
@testable import CaptureAudio

final class CaptureAudioTests: XCTestCase {
    private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!
    private func tone(_ hz: Double, start: Int, count: Int) -> AVAudioPCMBuffer {
        let b = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))!
        b.frameLength = AVAudioFrameCount(count)
        for i in 0..<count { b.floatChannelData![0][i] = Float(0.2 * sin(Double(start + i) * hz * 2 * .pi / 16_000)) }
        return b
    }
    private func amplitude(_ samples: [Float], hz: Double) -> Double {
        var re = 0.0, im = 0.0
        for (i, s) in samples.enumerated() {
            let phase = Double(i) * hz * 2 * .pi / 16_000
            re += Double(s) * cos(phase); im += Double(s) * sin(phase)
        }
        return 2 * hypot(re, im) / Double(samples.count)
    }

    func testBothSourcesSurviveDifferentCallbackSizesAndRepeatedSessions() throws {
        for _ in 0..<10 {
            var output: [Float] = []
            let pipeline = CaptureAudioPipeline(mixed: true, origin: 100) { buffer in
                output += Array(UnsafeBufferPointer(start: buffer.floatChannelData![0], count: Int(buffer.frameLength)))
            }
            var events: [(Double, CaptureAudioPipeline.Source, Int, Int)] = []
            for (source, size) in [(CaptureAudioPipeline.Source.microphone, 682), (.system, 1024)] {
                for start in stride(from: 0, to: 16_000, by: size) {
                    let count = min(size, 16_000 - start)
                    events.append((Double(start + count), source, start, count))
                }
            }
            for event in events.sorted(by: { $0.0 < $1.0 }) {
                let buffer = tone(event.1 == .microphone ? 440 : 660, start: event.2, count: event.3)
                XCTAssertTrue(pipeline.append(buffer, source: event.1, at: 100 + Double(event.2) / 16_000))
                pipeline.synchronize {} // Model the downstream keeping pace with live callbacks.
                // A tap reuses its buffer after return; capture must retain its own samples.
                buffer.floatChannelData![0].initialize(repeating: 0, count: event.3)
            }
            pipeline.finish()
            XCTAssertEqual(output.count, 16_000)
            XCTAssertEqual(amplitude(output, hz: 440), 0.2, accuracy: 0.001)
            XCTAssertEqual(amplitude(output, hz: 660), 0.2, accuracy: 0.001)
            XCTAssertFalse(pipeline.append(tone(440, start: 0, count: 160), source: .microphone, at: 101))
        }
    }

    func testDelayedAirPodsSizedCallbacksDoNotLoseMicrophoneSpeech() {
        var output: [Float] = []
        let pipeline = CaptureAudioPipeline(mixed: true, origin: 100) { b in
            output += Array(UnsafeBufferPointer(start: b.floatChannelData![0], count: Int(b.frameLength)))
        }
        var events: [(Double, CaptureAudioPipeline.Source, Int, Int)] = []
        for (source, size, latency) in [(CaptureAudioPipeline.Source.microphone, 2_048, 320), (.system, 320, 0)] {
            for start in stride(from: 0, to: 16_000, by: size) {
                let count = min(size, 16_000 - start)
                events.append((Double(start + count + latency), source, start, count))
            }
        }
        for e in events.sorted(by: { $0.0 < $1.0 }) {
            XCTAssertTrue(pipeline.append(tone(e.1 == .microphone ? 440 : 660, start: e.2, count: e.3), source: e.1, at: 100 + Double(e.2) / 16_000))
            pipeline.synchronize {}
        }
        pipeline.finish()
        XCTAssertEqual(output.count, 16_000)
        XCTAssertEqual(amplitude(output, hz: 440), 0.2, accuracy: 0.001)
        XCTAssertEqual(amplitude(output, hz: 660), 0.2, accuracy: 0.001)
    }

    func testSystemAudioContinuesWhileMicrophoneIsUnavailable() {
        var output: [Float] = []
        let pipeline = CaptureAudioPipeline(mixed: true, origin: 0) { b in
            output += Array(UnsafeBufferPointer(start: b.floatChannelData![0], count: Int(b.frameLength)))
        }
        for start in stride(from: 0, to: 8_000, by: 800) {
            XCTAssertTrue(pipeline.append(tone(660, start: start, count: 800), source: .system, at: Double(start) / 16_000))
            pipeline.synchronize {}
        }
        XCTAssertEqual(output.count, 0) // At most 500 ms waits for the missing microphone.
        pipeline.finish()
        XCTAssertEqual(output.count, 8_000)
        XCTAssertEqual(amplitude(output, hz: 660), 0.2, accuracy: 0.001)
    }

    func testStalledWriterHasABoundedQueueAndDrainsBeforeFinish() {
        let entered = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        var frames = 0
        let pipeline = CaptureAudioPipeline(mixed: false, origin: 0) { b in
            entered.signal()
            release.wait()
            frames += Int(b.frameLength)
        }
        XCTAssertTrue(pipeline.append(tone(660, start: 0, count: 8_000), source: .system, at: 0))
        XCTAssertEqual(entered.wait(timeout: .now() + 2), .success)
        XCTAssertTrue(pipeline.append(tone(660, start: 8_000, count: 8_000), source: .system, at: 0.5))
        XCTAssertFalse(pipeline.append(tone(660, start: 16_000, count: 160), source: .system, at: 1))
        release.signal(); release.signal()
        pipeline.finish()
        XCTAssertEqual(frames, 16_000)
    }

    func testSystemOnlyCaptureRotatesFilesAndRestartsWithoutAPlaybackEngine() throws {
        for _ in 0..<5 {
            let first = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
            let second = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
            defer { try? FileManager.default.removeItem(at: first); try? FileManager.default.removeItem(at: second) }
            let settings = format.settings
            var file: AVAudioFile? = try AVAudioFile(forWriting: first, settings: settings)
            var writeError: Error?
            let pipeline = CaptureAudioPipeline(mixed: false, origin: 0) { b in
                do { try file?.write(from: b) } catch { writeError = error }
            }
            XCTAssertTrue(pipeline.append(tone(660, start: 0, count: 3_200), source: .system, at: 0))
            try pipeline.synchronize { file = nil; file = try AVAudioFile(forWriting: second, settings: settings) }
            XCTAssertTrue(pipeline.append(tone(660, start: 3_200, count: 3_200), source: .system, at: 0.2))
            pipeline.finish()
            pipeline.synchronize { file = nil }
            XCTAssertNil(writeError)
            for url in [first, second] {
                let read = try AVAudioFile(forReading: url)
                XCTAssertEqual(read.length, 3_200)
                let b = AVAudioPCMBuffer(pcmFormat: read.processingFormat, frameCapacity: 3_200)!
                try read.read(into: b)
                let samples = Array(UnsafeBufferPointer(start: b.floatChannelData![0], count: Int(b.frameLength)))
                XCTAssertEqual(amplitude(samples, hz: 660), 0.2, accuracy: 0.001)
            }
        }
    }
}
