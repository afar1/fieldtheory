import Foundation
import QuartzCore
import UIKit
import SwiftUI
import os

/// Timing-only, bounded storage shared by the main actor and audio owner. No
/// audio-session queries, serialization, disk writes, or main-actor hops here.
final class RecordingStartupTrace: @unchecked Sendable {
    enum AggregateStage: String, CaseIterable { case voiceBody, mainContent, listEnumeration, transcriptCard, rowDateFormatting }
    struct Aggregate: Codable, Sendable {
        var count = 0
        var totalMs = 0.0
        var maxMs = 0.0
    }
    struct Measurement {
        let trace: RecordingStartupTrace
        let stage: AggregateStage
        let startedAt: Double
        func finish() { trace.recordDuration(stage, milliseconds: (CACurrentMediaTime() - startedAt) * 1_000) }
    }
    struct Event: Codable, Sendable {
        let milliseconds: Double
        let stage: String
        let mainThread: Bool
        let threadID: UInt32
        let width: Double?
        let height: Double?
        let sequence: Int?
    }
    struct Snapshot: Codable, Sendable {
        let events: [Event]
        let droppedEvents: Int
        let aggregates: [String: Aggregate]
        let droppedMeasurements: Int
    }
    private struct Storage {
        var events: [Event] = []
        var droppedEvents = 0
        var closed = false
        var aggregates: [String: Aggregate] = [:]
        var droppedMeasurements = 0
        init() { events.reserveCapacity(384); aggregates.reserveCapacity(AggregateStage.allCases.count) }
    }
    let id = UUID().uuidString
    let startedAt: Double
    private let storage = OSAllocatedUnfairLock(initialState: Storage())
    private let signposter = OSSignposter(subsystem: "com.afar1.fieldtheory", category: "RecordingStartup")

    init(startedAt: Double = CACurrentMediaTime()) { self.startedAt = startedAt }

    func mark(_ stage: String, width: Double? = nil, height: Double? = nil, sequence: Int? = nil) {
        let event = Event(milliseconds: (CACurrentMediaTime() - startedAt) * 1_000,
                          stage: stage, mainThread: Thread.isMainThread,
                          threadID: pthread_mach_thread_np(pthread_self()), width: width, height: height, sequence: sequence)
        let accepted = storage.withLock { state in
            guard !state.closed else { return false }
            guard state.events.count < 384 else { state.droppedEvents += 1; return false }
            state.events.append(event)
            return true
        }
        if accepted, width == nil, sequence == nil {
            signposter.emitEvent("RecordingStartupStage", "attempt=\(self.id, privacy: .public) stage=\(stage, privacy: .public)")
        }
    }

    func startMeasurement(_ stage: AggregateStage) -> Measurement {
        Measurement(trace: self, stage: stage, startedAt: CACurrentMediaTime())
    }

    func recordDuration(_ stage: AggregateStage, milliseconds: Double) {
        storage.withLock { state in
            guard !state.closed else { return }
            var aggregate = state.aggregates[stage.rawValue] ?? Aggregate()
            guard aggregate.count < 10_000 else { state.droppedMeasurements += 1; return }
            aggregate.count += 1
            aggregate.totalMs += milliseconds
            aggregate.maxMs = max(aggregate.maxMs, milliseconds)
            state.aggregates[stage.rawValue] = aggregate
        }
    }

    func close() -> Snapshot {
        storage.withLock { state in
            state.closed = true
            return Snapshot(events: state.events, droppedEvents: state.droppedEvents,
                            aggregates: state.aggregates, droppedMeasurements: state.droppedMeasurements)
        }
    }
}

/// Enabled only in a Debug build by an explicit launch flag. The choice persists
/// for subsequent ordinary launches; --disable-recording-startup-diagnostics
/// turns it off. A six-second window measures scheduling, not presented FPS.
@MainActor
final class RecordingStartupDiagnostics: NSObject {
    static let enabled: Bool = {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        let defaults = UserDefaults.standard
        // UI tests can opt in without leaving diagnostics enabled for later runs.
        if args.contains("--recording-startup-diagnostics-once") { return true }
        if args.contains("--disable-recording-startup-diagnostics") {
            defaults.set(false, forKey: "ft-recording-startup-diagnostics")
        } else if args.contains("--recording-startup-diagnostics") {
            defaults.set(true, forKey: "ft-recording-startup-diagnostics")
        }
        return defaults.bool(forKey: "ft-recording-startup-diagnostics")
        #else
        return false
        #endif
    }()
    private static let shared = RecordingStartupDiagnostics()
    static func configureIfEnabled() { if enabled { _ = shared } }
    static var activeTrace: RecordingStartupTrace? { enabled ? shared.trace : nil }
    static func acceptedTap() { if enabled { shared.begin() } }
    static func mark(_ stage: String) { activeTrace?.mark(stage) }
    static func startMeasurement(_ stage: RecordingStartupTrace.AggregateStage) -> RecordingStartupTrace.Measurement? {
        activeTrace?.startMeasurement(stage)
    }
    static func measure<T>(_ stage: RecordingStartupTrace.AggregateStage, _ operation: () -> T) -> T {
        let measurement = startMeasurement(stage)
        defer { measurement?.finish() }
        return operation()
    }
    static func setTranscriptCount(_ count: Int) { if enabled { shared.transcriptCount = count } }
    static func geometry(_ size: CGSize) {
        activeTrace?.mark("ui.pill-geometry", width: size.width, height: size.height)
    }
    static func finish(_ reason: String, matching attempt: RecordingStartupTrace?) {
        guard enabled, let attempt, shared.trace === attempt else { return }
        shared.finishWindow(reason)
    }

    private struct Frame: Codable, Sendable {
        let milliseconds: Double
        let callbackIntervalMs: Double
        let targetIntervalMs: Double
    }
    private struct Heartbeat: Codable, Sendable {
        let milliseconds: Double
        let mainQueueDelayMs: Double
    }
    private struct Metadata: Codable, Sendable {
        let build: String
        let commit: String
        let deviceModel: String
        let osVersion: String
        let screenMaximumFPS: Int
        let reduceMotion: Bool
        let lowPower: Bool
        let thermalState: Int
        let sampledAtUptimeSeconds: Double
    }
    private struct Report: Encodable, Sendable {
        let measurement = "CADisplayLink callback cadence, main-queue heartbeat delay and SwiftUI layout observations; not presented-frame FPS or a call-stack profile. Timing only, no audio/transcript. Cross-thread events can append out of timestamp order; order by milliseconds. Conditions sampled at window end."
        let attemptID: String
        let transcriptCount: Int?
        let metadata: Metadata
        let endReason: String
        let durationMs: Double
        let droppedFrames: Int
        let droppedHeartbeats: Int
        let stageEvents: RecordingStartupTrace.Snapshot
        let frames: [Frame]
        let heartbeats: [Heartbeat]
    }
    private struct PulseState { var active = true; var pending = false }
    private var trace: RecordingStartupTrace?
    private var transcriptCount: Int?
    private var displayLink: CADisplayLink?
    private var watchdog: DispatchSourceTimer?
    private var pulseState: OSAllocatedUnfairLock<PulseState>?
    private var endingTask: Task<Void, Never>?
    private var frames: [Frame] = []
    private var heartbeats: [Heartbeat] = []
    private var droppedFrames = 0
    private var droppedHeartbeats = 0
    private var lastCallback = 0.0
    private let writer = DispatchQueue(label: "com.afar1.fieldtheory.startup-diagnostics-writer", qos: .utility)
    private let watchdogQueue = DispatchQueue(label: "com.afar1.fieldtheory.startup-watchdog", qos: .utility)
    private let logger = Logger(subsystem: "com.afar1.fieldtheory", category: "RecordingStartup")
    private let metadata: Metadata

    private override init() {
        // Created from Voice.onAppear, before the measured tap.
        metadata = Metadata(build: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
                            commit: Bundle.main.object(forInfoDictionaryKey: "FTBuildCommit") as? String ?? "unknown",
                            deviceModel: UIDevice.current.model, osVersion: UIDevice.current.systemVersion,
                            screenMaximumFPS: UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                                .first(where: { $0.activationState == .foregroundActive })?.screen.maximumFramesPerSecond ?? 60,
                            reduceMotion: UIAccessibility.isReduceMotionEnabled,
                            lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled,
                            thermalState: ProcessInfo.processInfo.thermalState.rawValue,
                            sampledAtUptimeSeconds: CACurrentMediaTime())
        super.init()
        frames.reserveCapacity(1_024)
        heartbeats.reserveCapacity(128)
    }

    private func begin() {
        if trace != nil { finishWindow("superseded-by-next-tap") }
        let attempt = RecordingStartupTrace()
        trace = attempt
        frames.removeAll(keepingCapacity: true)
        heartbeats.removeAll(keepingCapacity: true)
        droppedFrames = 0
        droppedHeartbeats = 0
        lastCallback = attempt.startedAt // Preserve tap-to-first-callback stall.
        attempt.mark("tap.accepted")
        let link = CADisplayLink(target: self, selector: #selector(frame(_:)))
        // Do not change the screen's cadence to make the measurements look better.
        link.add(to: .main, forMode: .common)
        displayLink = link
        let state = OSAllocatedUnfairLock(initialState: PulseState())
        pulseState = state
        let timer = DispatchSource.makeTimerSource(queue: watchdogQueue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(100), leeway: .milliseconds(10))
        timer.setEventHandler { [weak self] in
            let shouldEnqueue = state.withLock { value in
                guard value.active, !value.pending else { return false }
                value.pending = true
                return true
            }
            guard shouldEnqueue else { return }
            let queuedAt = CACurrentMediaTime()
            DispatchQueue.main.async { [weak self] in
                let active = state.withLock { value in value.pending = false; return value.active }
                guard active, let self, self.trace === attempt else { return }
                let now = CACurrentMediaTime()
                if self.heartbeats.count < 128 {
                    self.heartbeats.append(.init(milliseconds: (now - attempt.startedAt) * 1_000,
                                                 mainQueueDelayMs: (now - queuedAt) * 1_000))
                } else { self.droppedHeartbeats += 1 }
            }
        }
        watchdog = timer
        timer.resume()
        endingTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .seconds(6)) } catch { return }
            guard let self, self.trace === attempt else { return }
            self.finishWindow("six-second-window")
        }
    }

    @objc private func frame(_ link: CADisplayLink) {
        guard let trace else { return }
        let now = CACurrentMediaTime()
        if frames.count < 1_024 {
            frames.append(.init(milliseconds: (now - trace.startedAt) * 1_000,
                                callbackIntervalMs: (now - lastCallback) * 1_000,
                                targetIntervalMs: (link.targetTimestamp - link.timestamp) * 1_000))
        } else { droppedFrames += 1 }
        lastCallback = now
    }

    private func finishWindow(_ reason: String) {
        guard let attempt = trace else { return }
        attempt.mark("window.\(reason)")
        trace = nil
        displayLink?.invalidate()
        displayLink = nil
        pulseState?.withLock { $0.active = false }
        pulseState = nil
        watchdog?.cancel()
        watchdog = nil
        endingTask?.cancel()
        endingTask = nil
        // Refresh changing conditions after the hot transition, not on the tap.
        let conditions = Metadata(build: metadata.build, commit: metadata.commit,
                                  deviceModel: metadata.deviceModel, osVersion: metadata.osVersion,
                                  screenMaximumFPS: metadata.screenMaximumFPS,
                                  reduceMotion: UIAccessibility.isReduceMotionEnabled,
                                  lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled,
                                  thermalState: ProcessInfo.processInfo.thermalState.rawValue,
                                  sampledAtUptimeSeconds: CACurrentMediaTime())
        let report = Report(attemptID: attempt.id, transcriptCount: transcriptCount, metadata: conditions, endReason: reason,
                            durationMs: (CACurrentMediaTime() - attempt.startedAt) * 1_000,
                            droppedFrames: droppedFrames, droppedHeartbeats: droppedHeartbeats,
                            stageEvents: attempt.close(), frames: frames, heartbeats: heartbeats)
        // No flush is awaited and no I/O occurs on capture, render, or main paths.
        writer.async { [logger] in
            let directory = RecorderController.voiceDiagnosticsDir.appendingPathComponent("RecordingStartup", isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let name = "\(Int64(Date().timeIntervalSince1970 * 1_000))-\(report.attemptID).json"
                let data = try JSONEncoder().encode(report)
                try data.write(to: directory.appendingPathComponent(name), options: .atomic)
                let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
                    .filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
                for file in files.dropLast(10) { try? FileManager.default.removeItem(at: file) }
                logger.notice("Recording startup timing report saved")
            } catch { logger.error("Startup timing export failed: \(error.localizedDescription, privacy: .public)") }
        }
    }
}

/// No additional geometry observer exists when diagnostics are disabled.
struct RecordingStartupGeometryObservation: ViewModifier {
    func body(content: Content) -> some View {
        if RecordingStartupDiagnostics.enabled {
            content.onGeometryChange(for: CGSize.self) { $0.size } action: { size in
                RecordingStartupDiagnostics.geometry(size)
            }
        } else { content }
    }
}
