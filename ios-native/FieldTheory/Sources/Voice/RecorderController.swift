import AVFoundation
import Foundation
import Observation
import os
import UIKit

enum RecorderPhase: Equatable {
    case idle
    case recording
    case transcribing
}

struct PendingAudioSession: Equatable, Identifiable {
    let id: String
    let files: [URL]
}

/// Records 16 kHz mono WAV with the audio background mode keeping the
/// session alive while the screen is locked. Call interruptions finalize the
/// current segment and auto-resume into a new one when the system hands the
/// mic back, so one tap can capture an arbitrarily long session.
@MainActor
@Observable
final class RecorderController {
    private(set) var phase: RecorderPhase = .idle
    private(set) var startedAt: Date?
    private(set) var level: Float = 0 // 0...1 for the waveform
    private(set) var elapsed: TimeInterval = 0
    private(set) var pendingSessionCount = 0
    var lastError: String?

    private var recorder: AVAudioRecorder?
    private var segmentURLs: [URL] = []
    private var sessionId: Int64 = 0
    private var meterTimer: Timer?
    private var interruptionObserver: NSObjectProtocol?
    private var draining = false
    private var backgroundTasks = Set<UIBackgroundTaskIdentifier>()
    private let logger = Logger(subsystem: "com.afar1.fieldtheory", category: "Voice")

    /// Set by the app: receives the final transcript text for routing
    /// (insert at cursor vs. save to Voice).
    var onTranscript: ((String) async -> Void)?
    /// Lightweight status line for toasts (queued audio, errors).
    var onNotice: ((String, String) -> Void)?

    let whisper = WhisperService()
    let models = ModelManager()

    /// Recordings waiting for the model; survives relaunches.
    static var pendingAudioDir: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("pending-audio", isDirectory: true)
    }

    init() {
        refreshPendingAudioStatus()
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in self?.handleInterruption(notification) }
        }
        models.onReady = { [weak self] in
            Task { await self?.resumePendingWork() }
        }
    }

    var isRecording: Bool { phase == .recording }

    func toggle() {
        switch phase {
        case .idle: start()
        case .recording: Task { await stopAndTranscribe() }
        case .transcribing: break
        }
    }

    func start() {
        guard phase == .idle else { return }
        lastError = nil
        AVAudioApplication.requestRecordPermission { [weak self] granted in
            Task { @MainActor in
                guard let self else { return }
                guard granted else {
                    self.lastError = "Microphone access is off. Enable it in Settings."
                    return
                }
                self.beginSession()
            }
        }
    }

    private func beginSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetoothHFP])
            try session.setActive(true)
            segmentURLs = []
            sessionId = Timestamps.nowMs()
            try startNewSegment()
            phase = .recording
            startedAt = Date()
            elapsed = 0
            startMetering()
        } catch {
            lastError = "Could not start recording: \(error.localizedDescription)"
            onNotice?("Couldn't start recording", "exclamationmark.triangle")
            phase = .idle
        }
    }

    private func startNewSegment() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("rec-\(sessionId)-\(segmentURLs.count).wav")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ]
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.isMeteringEnabled = true
        recorder.record()
        self.recorder = recorder
        segmentURLs.append(url)
    }

    private func startMetering() {
        meterTimer?.invalidate()
        meterTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let recorder = self.recorder, self.phase == .recording else { return }
                recorder.updateMeters()
                let decibels = recorder.averagePower(forChannel: 0)
                self.level = max(0, min(1, (decibels + 50) / 50))
                if let startedAt = self.startedAt {
                    self.elapsed = Date().timeIntervalSince(startedAt)
                }
            }
        }
    }

    private func handleInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

        switch type {
        case .began:
            // A call (or Siri) took the mic. Seal this segment; we resume after.
            recorder?.stop()
            recorder = nil
        case .ended:
            guard phase == .recording else { return }
            let options = (info[AVAudioSessionInterruptionOptionKey] as? UInt)
                .map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
            if options.contains(.shouldResume) || UIApplication.shared.applicationState != .background {
                try? AVAudioSession.sharedInstance().setActive(true)
                try? startNewSegment()
            }
        @unknown default:
            break
        }
    }

    func stopAndTranscribe() async {
        guard phase == .recording else { return }
        meterTimer?.invalidate()
        recorder?.stop()
        recorder = nil
        level = 0

        let urls = segmentURLs
        segmentURLs = []
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        logger.info("Voice recording stopped with \(urls.count, privacy: .public) segment(s)")

        let queued = queueForRetry(urls)
        guard !queued.isEmpty else {
            phase = .idle
            startedAt = nil
            return
        }

        guard models.readyModelURL != nil else {
            phase = .idle
            startedAt = nil
            models.ensureDownloaded()
            onNotice?("Saved — transcribing when the speech model finishes", "clock.arrow.circlepath")
            return
        }

        phase = .idle
        startedAt = nil
        await drainPendingQueue()
    }

    private func transcribeSegments(_ urls: [URL], modelURL: URL) async throws -> String {
        var parts: [String] = []
        for url in urls {
            logger.info("Voice transcription starting for \(url.lastPathComponent, privacy: .public)")
            let text = try await whisper.transcribe(audioURL: url, modelURL: modelURL)
            logger.info("Voice transcription finished for \(url.lastPathComponent, privacy: .public)")
            if !text.isEmpty { parts.append(text) }
        }
        return parts.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Transcribes recordings that were parked while the model downloaded.
    /// Segments are grouped by recording session (rec-<session>-<index>.wav)
    /// so one long capture stays one transcript.
    func drainPendingQueue() async {
        refreshPendingAudioStatus()
        guard !draining, phase != .recording, pendingSessionCount > 0 else { return }
        guard onTranscript != nil else {
            logger.info("Voice pending queue is waiting for transcript routing")
            return
        }
        guard let modelURL = models.readyModelURL else {
            models.ensureDownloaded()
            return
        }

        draining = true
        let task = beginBackgroundTask()
        phase = .transcribing
        logger.info("Voice pending queue drain started")
        defer {
            phase = .idle
            startedAt = nil
            draining = false
            finishBackgroundTask(task)
            refreshPendingAudioStatus()
            logger.info("Voice pending queue drain ended with \(self.pendingSessionCount, privacy: .public) pending session(s)")
        }

        for session in Self.pendingSessions(in: Self.pendingAudioDir) {
            do {
                let transcript = try await transcribeSegments(session.files, modelURL: modelURL)
                if transcript.isEmpty {
                    onNotice?("No speech detected", "waveform.badge.magnifyingglass")
                } else {
                    await onTranscript?(transcript)
                }
                for url in session.files { try? FileManager.default.removeItem(at: url) }
                lastError = nil
                refreshPendingAudioStatus()
            } catch {
                lastError = "Transcription failed: \(error.localizedDescription)"
                logger.error("Voice transcription failed: \(error.localizedDescription, privacy: .public)")
                onNotice?("Saved — retry transcription when Field Theory is open", "clock.arrow.circlepath")
                break
            }
        }
    }

    func resumePendingWork() async {
        refreshPendingAudioStatus()
        await drainPendingQueue()
    }

    func refreshPendingAudioStatus() {
        pendingSessionCount = Self.pendingSessions(in: Self.pendingAudioDir).count
    }

    private func queueForRetry(_ urls: [URL]) -> [URL] {
        guard !urls.isEmpty else { return [] }
        do {
            try FileManager.default.createDirectory(at: Self.pendingAudioDir, withIntermediateDirectories: true)
        } catch {
            lastError = "Could not save recording: \(error.localizedDescription)"
            logger.error("Voice pending directory could not be created: \(error.localizedDescription, privacy: .public)")
            onNotice?("Could not save recording", "exclamationmark.triangle")
            return []
        }

        var queued: [URL] = []
        for url in urls where FileManager.default.fileExists(atPath: url.path) {
            let parked = Self.pendingAudioDir.appendingPathComponent(url.lastPathComponent)
            do {
                if parked != url, FileManager.default.fileExists(atPath: parked.path) {
                    try FileManager.default.removeItem(at: parked)
                }
                if parked != url {
                    try FileManager.default.moveItem(at: url, to: parked)
                }
                queued.append(parked)
                logger.info("Voice audio queued at \(parked.lastPathComponent, privacy: .public)")
            } catch {
                lastError = "Could not save recording: \(error.localizedDescription)"
                logger.error("Voice audio could not be queued: \(error.localizedDescription, privacy: .public)")
                onNotice?("Could not save recording", "exclamationmark.triangle")
            }
        }
        refreshPendingAudioStatus()
        return queued
    }

    private func beginBackgroundTask() -> UIBackgroundTaskIdentifier {
        var task: UIBackgroundTaskIdentifier = .invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "FieldTheoryVoiceTranscription") { [weak self] in
            Task { @MainActor in
                self?.logger.warning("Voice background transcription task expired")
                self?.onNotice?("Saved — retrying when Field Theory reopens", "clock.arrow.circlepath")
                self?.finishBackgroundTask(task)
            }
        }
        if task != .invalid { backgroundTasks.insert(task) }
        return task
    }

    private func finishBackgroundTask(_ task: UIBackgroundTaskIdentifier) {
        guard task != .invalid, backgroundTasks.remove(task) != nil else { return }
        UIApplication.shared.endBackgroundTask(task)
    }

    nonisolated static func pendingSessions(in directory: URL) -> [PendingAudioSession] {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        let wavs = files.filter { $0.pathExtension == "wav" }
        var sessions: [String: [URL]] = [:]
        for url in wavs {
            sessions[pendingSessionID(for: url), default: []].append(url)
        }
        return sessions
            .map { id, files in PendingAudioSession(id: id, files: files.sorted(by: pendingAudioSort)) }
            .sorted { lhs, rhs in
                if let left = Int64(lhs.id), let right = Int64(rhs.id) {
                    return left < right
                }
                return lhs.id < rhs.id
            }
    }

    private nonisolated static func pendingSessionID(for url: URL) -> String {
        let stem = url.deletingPathExtension().lastPathComponent
        let parts = stem.split(separator: "-")
        if parts.count >= 3, parts.first == "rec" {
            return String(parts[1])
        }
        return stem
    }

    private nonisolated static func pendingAudioSort(_ lhs: URL, _ rhs: URL) -> Bool {
        let left = pendingSegmentIndex(for: lhs)
        let right = pendingSegmentIndex(for: rhs)
        if left != right { return left < right }
        return lhs.lastPathComponent < rhs.lastPathComponent
    }

    private nonisolated static func pendingSegmentIndex(for url: URL) -> Int {
        let stem = url.deletingPathExtension().lastPathComponent
        let parts = stem.split(separator: "-")
        guard parts.count >= 3, parts.first == "rec" else { return 0 }
        return Int(parts[2]) ?? 0
    }
}
