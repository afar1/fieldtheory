import AVFoundation
import Foundation
import Observation
import UIKit

enum RecorderPhase: Equatable {
    case idle
    case recording
    case transcribing
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
    var lastError: String?

    private var recorder: AVAudioRecorder?
    private var segmentURLs: [URL] = []
    private var sessionId: Int64 = 0
    private var meterTimer: Timer?
    private var interruptionObserver: NSObjectProtocol?
    private var draining = false

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
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in self?.handleInterruption(notification) }
        }
        models.onReady = { [weak self] in
            Task { await self?.drainPendingQueue() }
        }
        if models.readyModelURL != nil {
            Task { await drainPendingQueue() }
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

        guard let modelURL = models.readyModelURL else {
            // Capture is sacred: park the audio and transcribe when the
            // model lands.
            phase = .idle
            startedAt = nil
            try? FileManager.default.createDirectory(at: Self.pendingAudioDir, withIntermediateDirectories: true)
            for url in urls {
                let parked = Self.pendingAudioDir.appendingPathComponent(url.lastPathComponent)
                try? FileManager.default.moveItem(at: url, to: parked)
            }
            models.ensureDownloaded()
            onNotice?("Saved — transcribing when the speech model finishes", "clock.arrow.circlepath")
            return
        }

        phase = .transcribing
        defer {
            phase = .idle
            startedAt = nil
            for url in urls { try? FileManager.default.removeItem(at: url) }
        }

        if let transcript = await transcribeSegments(urls, modelURL: modelURL) {
            await onTranscript?(transcript)
        }
    }

    private func transcribeSegments(_ urls: [URL], modelURL: URL) async -> String? {
        var parts: [String] = []
        for url in urls {
            do {
                let text = try await whisper.transcribe(audioURL: url, modelURL: modelURL)
                if !text.isEmpty { parts.append(text) }
            } catch {
                lastError = "Transcription failed: \(error.localizedDescription)"
                onNotice?("Transcription failed", "exclamationmark.triangle")
            }
        }
        let transcript = parts.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        return transcript.isEmpty ? nil : transcript
    }

    /// Transcribes recordings that were parked while the model downloaded.
    /// Segments are grouped by recording session (rec-<session>-<index>.wav)
    /// so one long capture stays one transcript.
    func drainPendingQueue() async {
        guard !draining, let modelURL = models.readyModelURL else { return }
        let files = (try? FileManager.default.contentsOfDirectory(at: Self.pendingAudioDir, includingPropertiesForKeys: nil)) ?? []
        let wavs = files.filter { $0.pathExtension == "wav" }
        guard !wavs.isEmpty else { return }

        draining = true
        defer { draining = false }

        var sessions: [String: [URL]] = [:]
        for url in wavs {
            let parts = url.deletingPathExtension().lastPathComponent.split(separator: "-")
            let session = parts.count >= 2 ? String(parts[1]) : url.lastPathComponent
            sessions[session, default: []].append(url)
        }

        for (_, sessionFiles) in sessions.sorted(by: { $0.key < $1.key }) {
            let ordered = sessionFiles.sorted { $0.lastPathComponent < $1.lastPathComponent }
            if let transcript = await transcribeSegments(ordered, modelURL: modelURL) {
                await onTranscript?(transcript)
            }
            for url in ordered { try? FileManager.default.removeItem(at: url) }
        }
    }
}
