import UIKit
import AVFoundation
import WhisperKit

class KeyboardViewController: UIInputViewController {

    private enum State {
        case idle
        case recording
        case transcribing
        case noAccess
    }

    private var state: State = .idle

    private let backgroundView = UIView()

    private let idleStack = UIStackView()
    private let idleIcon = UIImageView()
    private let idleLabel = UILabel()

    private let recordingStack = UIStackView()
    private let recordingDot = UIView()
    private let waveformView = WaveformView()
    private let doneButton = UIButton(type: .system)

    private let transcribingStack = UIStackView()
    private let transcribingSpinner = UIActivityIndicatorView(style: .medium)
    private let transcribingLabel = UILabel()

    private let noAccessLabel = UILabel()

    // Audio.
    private var audioRecorder: AVAudioRecorder?
    private var meterTimer: Timer?
    private var recordingURL: URL?

    // Whisper.
    private var whisperKit: WhisperKit?
    private var whisperLoadTask: Task<WhisperKit?, Never>?

    override func viewDidLoad() {
        super.viewDidLoad()
        setupViews()
        refreshState()
        prewarmWhisper()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        refreshState()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if state == .recording { abortRecording() }
    }

    // MARK: - Setup

    private func setupViews() {
        view.translatesAutoresizingMaskIntoConstraints = false
        view.heightAnchor.constraint(equalToConstant: 80).isActive = true

        backgroundView.translatesAutoresizingMaskIntoConstraints = false
        backgroundView.backgroundColor = UIColor(white: 0.96, alpha: 1.0)
        view.addSubview(backgroundView)

        // Idle.
        let micConfig = UIImage.SymbolConfiguration(pointSize: 22, weight: .regular)
        idleIcon.image = UIImage(systemName: "mic.fill", withConfiguration: micConfig)
        idleIcon.tintColor = .systemBlue
        idleIcon.contentMode = .scaleAspectFit

        idleLabel.text = "Tap to record"
        idleLabel.font = .systemFont(ofSize: 17, weight: .medium)
        idleLabel.textColor = .label

        idleStack.axis = .horizontal
        idleStack.alignment = .center
        idleStack.spacing = 10
        idleStack.translatesAutoresizingMaskIntoConstraints = false
        idleStack.isUserInteractionEnabled = false
        idleStack.addArrangedSubview(idleIcon)
        idleStack.addArrangedSubview(idleLabel)
        view.addSubview(idleStack)

        // Recording.
        recordingDot.backgroundColor = .systemRed
        recordingDot.layer.cornerRadius = 6
        recordingDot.translatesAutoresizingMaskIntoConstraints = false

        waveformView.translatesAutoresizingMaskIntoConstraints = false

        doneButton.setTitle("Done", for: .normal)
        doneButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        doneButton.setTitleColor(.white, for: .normal)
        doneButton.backgroundColor = .systemBlue
        doneButton.layer.cornerRadius = 10
        doneButton.contentEdgeInsets = UIEdgeInsets(top: 8, left: 16, bottom: 8, right: 16)
        doneButton.translatesAutoresizingMaskIntoConstraints = false
        doneButton.addTarget(self, action: #selector(handleDone), for: .touchUpInside)

        recordingStack.axis = .horizontal
        recordingStack.alignment = .center
        recordingStack.spacing = 12
        recordingStack.translatesAutoresizingMaskIntoConstraints = false
        recordingStack.isHidden = true
        view.addSubview(recordingStack)

        let dotContainer = UIView()
        dotContainer.translatesAutoresizingMaskIntoConstraints = false
        dotContainer.addSubview(recordingDot)
        recordingStack.addArrangedSubview(dotContainer)
        recordingStack.addArrangedSubview(waveformView)
        recordingStack.addArrangedSubview(doneButton)

        // Transcribing.
        transcribingSpinner.translatesAutoresizingMaskIntoConstraints = false
        transcribingLabel.text = "Transcribing…"
        transcribingLabel.font = .systemFont(ofSize: 15, weight: .medium)
        transcribingLabel.textColor = .secondaryLabel

        transcribingStack.axis = .horizontal
        transcribingStack.alignment = .center
        transcribingStack.spacing = 10
        transcribingStack.translatesAutoresizingMaskIntoConstraints = false
        transcribingStack.isHidden = true
        transcribingStack.addArrangedSubview(transcribingSpinner)
        transcribingStack.addArrangedSubview(transcribingLabel)
        view.addSubview(transcribingStack)

        // No-access.
        noAccessLabel.text = "Enable Full Access in Settings →"
        noAccessLabel.font = .systemFont(ofSize: 15, weight: .medium)
        noAccessLabel.textColor = .secondaryLabel
        noAccessLabel.textAlignment = .center
        noAccessLabel.translatesAutoresizingMaskIntoConstraints = false
        noAccessLabel.isHidden = true
        view.addSubview(noAccessLabel)

        let tap = UITapGestureRecognizer(target: self, action: #selector(handleStripTap))
        let longPress = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress))
        longPress.minimumPressDuration = 0.6
        backgroundView.addGestureRecognizer(tap)
        backgroundView.addGestureRecognizer(longPress)
        backgroundView.isUserInteractionEnabled = true

        NSLayoutConstraint.activate([
            backgroundView.topAnchor.constraint(equalTo: view.topAnchor),
            backgroundView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            backgroundView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            backgroundView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            idleStack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            idleStack.centerYAnchor.constraint(equalTo: view.centerYAnchor),

            noAccessLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            noAccessLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),

            transcribingStack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            transcribingStack.centerYAnchor.constraint(equalTo: view.centerYAnchor),

            recordingStack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            recordingStack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            recordingStack.centerYAnchor.constraint(equalTo: view.centerYAnchor),

            dotContainer.widthAnchor.constraint(equalToConstant: 12),
            recordingDot.widthAnchor.constraint(equalToConstant: 12),
            recordingDot.heightAnchor.constraint(equalToConstant: 12),
            recordingDot.centerXAnchor.constraint(equalTo: dotContainer.centerXAnchor),
            recordingDot.centerYAnchor.constraint(equalTo: dotContainer.centerYAnchor),
        ])
    }

    // MARK: - State

    private func refreshState() {
        if !hasFullAccess {
            state = .noAccess
        } else if state == .noAccess {
            state = .idle
        }
        applyState()
    }

    private func applyState() {
        switch state {
        case .idle:
            backgroundView.backgroundColor = UIColor(white: 0.96, alpha: 1.0)
            idleStack.isHidden = false
            recordingStack.isHidden = true
            transcribingStack.isHidden = true
            noAccessLabel.isHidden = true
            transcribingSpinner.stopAnimating()
        case .recording:
            backgroundView.backgroundColor = UIColor.systemBlue.withAlphaComponent(0.06)
            idleStack.isHidden = true
            recordingStack.isHidden = false
            transcribingStack.isHidden = true
            noAccessLabel.isHidden = true
            pulseDot()
        case .transcribing:
            backgroundView.backgroundColor = UIColor(white: 0.96, alpha: 1.0)
            idleStack.isHidden = true
            recordingStack.isHidden = true
            transcribingStack.isHidden = false
            noAccessLabel.isHidden = true
            transcribingSpinner.startAnimating()
        case .noAccess:
            backgroundView.backgroundColor = UIColor(white: 0.96, alpha: 1.0)
            idleStack.isHidden = true
            recordingStack.isHidden = true
            transcribingStack.isHidden = true
            noAccessLabel.isHidden = false
        }
    }

    private func pulseDot() {
        recordingDot.layer.removeAllAnimations()
        UIView.animate(withDuration: 0.7, delay: 0, options: [.repeat, .autoreverse, .allowUserInteraction]) {
            self.recordingDot.alpha = 0.3
        }
    }

    // MARK: - Gestures

    @objc private func handleStripTap() {
        guard state == .idle else { return }
        startRecording()
    }

    @objc private func handleLongPress(_ recognizer: UILongPressGestureRecognizer) {
        guard recognizer.state == .began, state == .recording else { return }
        confirmCancel()
    }

    @objc private func handleDone() {
        guard state == .recording else { return }
        finishRecording()
    }

    private func confirmCancel() {
        let alert = UIAlertController(title: "Cancel recording?", message: nil, preferredStyle: .actionSheet)
        alert.addAction(UIAlertAction(title: "Yes, cancel", style: .destructive) { [weak self] _ in
            self?.abortRecording()
        })
        alert.addAction(UIAlertAction(title: "Keep recording", style: .cancel))
        present(alert, animated: true)
    }

    // MARK: - Recording

    private func startRecording() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: [])
            try session.setActive(true, options: [])
        } catch {
            NSLog("[littleai] audio session failed: \(error)")
            return
        }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("littleai-\(UUID().uuidString).m4a")
        recordingURL = url

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]

        do {
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.isMeteringEnabled = true
            audioRecorder = recorder
            guard recorder.record() else {
                NSLog("[littleai] recorder.record() returned false")
                return
            }
        } catch {
            NSLog("[littleai] recorder init failed: \(error)")
            return
        }

        state = .recording
        applyState()
        startMeterTimer()
    }

    private func startMeterTimer() {
        meterTimer?.invalidate()
        meterTimer = Timer.scheduledTimer(withTimeInterval: 0.04, repeats: true) { [weak self] _ in
            guard let self, let recorder = self.audioRecorder else { return }
            recorder.updateMeters()
            let db = recorder.averagePower(forChannel: 0)
            self.waveformView.push(level: self.normalize(db: db))
        }
    }

    private func normalize(db: Float) -> CGFloat {
        let minDb: Float = -50
        let clamped = max(minDb, min(db, 0))
        return CGFloat((clamped - minDb) / -minDb)
    }

    private func finishRecording() {
        guard let url = recordingURL else { return }
        teardownRecorder()

        state = .transcribing
        applyState()

        Task { [weak self] in
            guard let self else { return }
            let text = await self.transcribe(url: url)
            try? FileManager.default.removeItem(at: url)
            await MainActor.run {
                if !text.isEmpty {
                    self.textDocumentProxy.insertText(text + " ")
                }
                self.state = .idle
                self.applyState()
            }
        }
    }

    private func abortRecording() {
        teardownRecorder()
        if let url = recordingURL { try? FileManager.default.removeItem(at: url) }
        state = .idle
        applyState()
    }

    private func teardownRecorder() {
        meterTimer?.invalidate()
        meterTimer = nil
        audioRecorder?.stop()
        audioRecorder = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        recordingDot.layer.removeAllAnimations()
        recordingDot.alpha = 1
        waveformView.reset()
    }

    // MARK: - Whisper

    private func prewarmWhisper() {
        guard whisperKit == nil, whisperLoadTask == nil else { return }
        whisperLoadTask = Task { [weak self] in
            guard let self else { return nil }
            return await self.loadWhisperKit()
        }
    }

    private func loadWhisperKit() async -> WhisperKit? {
        guard let modelFolder = Bundle.main.url(
            forResource: "openai_whisper-tiny.en",
            withExtension: nil,
            subdirectory: "Models"
        ) else {
            NSLog("[littleai] tiny.en model folder not found in bundle")
            return nil
        }

        do {
            let config = WhisperKitConfig(
                modelFolder: modelFolder.path,
                verbose: false,
                logLevel: .error,
                load: true
            )
            let kit = try await WhisperKit(config)
            self.whisperKit = kit
            NSLog("[littleai] WhisperKit loaded")
            return kit
        } catch {
            NSLog("[littleai] WhisperKit load failed: \(error)")
            return nil
        }
    }

    private func transcribe(url: URL) async -> String {
        let kit: WhisperKit?
        if let existing = whisperKit {
            kit = existing
        } else if let task = whisperLoadTask {
            kit = await task.value
        } else {
            kit = await loadWhisperKit()
        }
        guard let kit else { return "" }

        do {
            let results = try await kit.transcribe(audioPath: url.path)
            let text = results.map { $0.text }.joined(separator: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return text
        } catch {
            NSLog("[littleai] transcribe failed: \(error)")
            return ""
        }
    }
}

// MARK: - WaveformView

private final class WaveformView: UIView {
    private let barCount = 28
    private var levels: [CGFloat]
    private let bars: [CALayer]

    override init(frame: CGRect) {
        levels = Array(repeating: 0.05, count: 28)
        bars = (0..<28).map { _ in CALayer() }
        super.init(frame: frame)
        bars.forEach {
            $0.backgroundColor = UIColor.systemBlue.cgColor
            $0.cornerRadius = 1.5
            layer.addSublayer($0)
        }
    }

    required init?(coder: NSCoder) { fatalError() }

    func push(level: CGFloat) {
        levels.removeFirst()
        levels.append(max(0.04, min(level, 1)))
        setNeedsLayout()
    }

    func reset() {
        levels = Array(repeating: 0.05, count: barCount)
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let totalWidth = bounds.width
        let barWidth: CGFloat = 3
        let spacing = (totalWidth - barWidth * CGFloat(barCount)) / CGFloat(barCount - 1)
        for (i, bar) in bars.enumerated() {
            let h = max(3, bounds.height * levels[i])
            let x = CGFloat(i) * (barWidth + spacing)
            let y = (bounds.height - h) / 2
            bar.frame = CGRect(x: x, y: y, width: barWidth, height: h)
        }
    }
}
