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
    private var meterTimer: Timer?
    private var interruptionObserver: NSObjectProtocol?

    /// Set by the app: receives the final transcript text for routing
    /// (insert at cursor vs. save to Voice).
    var onTranscript: ((String) async -> Void)?

    let whisper = WhisperService()
    let models = ModelManager()

    init() {
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in self?.handleInterruption(notification) }
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
            try startNewSegment()
            phase = .recording
            startedAt = Date()
            elapsed = 0
            startMetering()
        } catch {
            lastError = "Could not start recording: \(error.localizedDescription)"
            phase = .idle
        }
    }

    private func startNewSegment() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("rec-\(Timestamps.nowMs()).wav")
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
        phase = .transcribing
        level = 0

        let urls = segmentURLs
        segmentURLs = []
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        defer {
            phase = .idle
            startedAt = nil
            for url in urls { try? FileManager.default.removeItem(at: url) }
        }

        guard let modelURL = models.readyModelURL else {
            lastError = "Speech model not downloaded yet — grab it in Settings."
            return
        }

        var parts: [String] = []
        for url in urls {
            do {
                let text = try await whisper.transcribe(audioURL: url, modelURL: modelURL)
                if !text.isEmpty { parts.append(text) }
            } catch {
                lastError = "Transcription failed: \(error.localizedDescription)"
            }
        }
        let transcript = parts.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !transcript.isEmpty else {
            if lastError == nil { lastError = "Didn't catch anything." }
            return
        }
        await onTranscript?(transcript)
    }
}
