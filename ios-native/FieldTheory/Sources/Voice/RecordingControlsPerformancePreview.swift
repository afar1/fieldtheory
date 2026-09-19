#if targetEnvironment(simulator)
import Foundation
import QuartzCore
import UIKit
import os

/// Explicit simulator launch fixture. It never starts capture, transcription,
/// or delivery. CADisplayLink measures callback scheduling, not presented FPS.
@MainActor
final class RecordingControlsPerformancePreview: NSObject {
    static let shared = RecordingControlsPerformancePreview()
    private let logger = Logger(subsystem: "com.afar1.fieldtheory", category: "RecordingControlsPreview")
    private let signpost = OSSignposter(subsystem: "com.afar1.fieldtheory", category: "RecordingControlsPreview")
    private var displayLink: CADisplayLink?
    private var frames: [Frame] = []
    private var transitions: [Transition] = []
    private var startedAt = 0.0
    private var lastCallback: Double?
    private var state = "warmup"
    private var running = false

    enum State: String, CaseIterable {
        case idle, starting, recording, stopping, transcribing, saving, completed, error
        case longError, shortError, pending, pendingLong
    }
    private struct Frame: Codable {
        let elapsedMs: Double
        let callbackIntervalMs: Double?
        let displayTimestampMs: Double
        let targetIntervalMs: Double
        let state: String
    }
    private struct Transition: Codable {
        let elapsedMs: Double
        let state: String
        let cycle: Int
    }
    private struct Report: Codable {
        let measurement: String
        let extendedFixture: Bool
        let reduceMotionEnabled: Bool
        let requestedFramesPerSecond: Int
        let simulatorScreenMaximumFramesPerSecond: Int
        let durationMs: Double
        let callbackIntervalsOver20Ms: Int
        let callbackIntervalsOver34Ms: Int
        let p95CallbackIntervalMs: Double
        let maxCallbackIntervalMs: Double
        let transitions: [Transition]
        let frames: [Frame]
    }

    func run(recorder: RecorderController) {
        guard !running, ProcessInfo.processInfo.arguments.contains("ft-recording-controls-perf") else { return }
        running = true
        Task { @MainActor in
            // Let the preview mount and its initial ready confirmation settle.
            try? await Task.sleep(for: .seconds(3))
            startSampling()
            let standardStates: [State] = [.idle, .starting, .recording, .stopping, .transcribing, .saving, .completed, .error]
            let extended = ProcessInfo.processInfo.arguments.contains("ft-recording-controls-perf-extended")
            let states = extended ? standardStates + [.longError, .shortError, .pending, .pendingLong, .pending] : standardStates
            for cycle in 0..<3 {
                for next in states {
                    state = next.rawValue
                    transitions.append(.init(elapsedMs: (CACurrentMediaTime() - startedAt) * 1_000,
                                             state: state, cycle: cycle))
                    signpost.emitEvent("ControlTransition", "state=\(next.rawValue, privacy: .public) cycle=\(cycle)")
                    recorder.applyRecordingControlsPreview(next, cycle: cycle)
                    // Sample changing waveform/timer through the real recording label.
                    if next == .recording {
                        for tick in 0..<18 {
                            recorder.updateRecordingControlsPreviewMeter(tick: tick)
                            try? await Task.sleep(for: .milliseconds(80))
                        }
                    } else {
                        try? await Task.sleep(for: .milliseconds(next == .starting ? 450 : 1_400))
                    }
                }
            }
            recorder.applyRecordingControlsPreview(.idle, cycle: 3)
            try? await Task.sleep(for: .seconds(1))
            finishSampling()
            running = false
        }
    }

    private func startSampling() {
        frames.removeAll(keepingCapacity: true)
        frames.reserveCapacity(10_000)
        transitions.removeAll(keepingCapacity: true)
        lastCallback = nil
        startedAt = CACurrentMediaTime()
        let link = CADisplayLink(target: self, selector: #selector(frame(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    @objc private func frame(_ link: CADisplayLink) {
        let now = CACurrentMediaTime()
        frames.append(.init(elapsedMs: (now - startedAt) * 1_000,
                            callbackIntervalMs: lastCallback.map { (now - $0) * 1_000 },
                            displayTimestampMs: (link.timestamp - startedAt) * 1_000,
                            targetIntervalMs: (link.targetTimestamp - link.timestamp) * 1_000,
                            state: state))
        lastCallback = now
    }

    private func finishSampling() {
        displayLink?.invalidate()
        displayLink = nil
        let intervals = frames.compactMap(\.callbackIntervalMs).sorted()
        let report = Report(
            measurement: "Simulator CADisplayLink callback cadence only; does not prove presented frames, physical-device FPS, or absence of render-server hitches. Pair with Instruments Animation Hitches.",
            extendedFixture: ProcessInfo.processInfo.arguments.contains("ft-recording-controls-perf-extended"),
            reduceMotionEnabled: UIAccessibility.isReduceMotionEnabled,
            requestedFramesPerSecond: 120,
            simulatorScreenMaximumFramesPerSecond: UIScreen.main.maximumFramesPerSecond,
            durationMs: (CACurrentMediaTime() - startedAt) * 1_000,
            callbackIntervalsOver20Ms: intervals.filter { $0 > 20 }.count,
            callbackIntervalsOver34Ms: intervals.filter { $0 > 34 }.count,
            p95CallbackIntervalMs: intervals.isEmpty ? 0 : intervals[min(intervals.count - 1, Int(Double(intervals.count) * 0.95))],
            maxCallbackIntervalMs: intervals.last ?? 0,
            transitions: transitions, frames: frames)
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(ProcessInfo.processInfo.arguments.contains("ft-recording-controls-perf-extended")
                                    ? "recording-controls-performance-extended.json" : "recording-controls-performance.json")
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(report).write(to: url, options: .atomic)
            logger.notice("Simulator control callback report saved: \(url.path, privacy: .public)")
        } catch { logger.error("Could not write simulator control report: \(error.localizedDescription, privacy: .public)") }
    }
}
#endif
