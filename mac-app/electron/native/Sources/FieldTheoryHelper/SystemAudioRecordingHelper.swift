import Foundation
import AVFoundation
import CoreMedia
import CoreGraphics
import ScreenCaptureKit

enum RecordingSource: String, Codable {
    case microphone = "microphone"
    case systemAudio = "system-audio"
}

enum RecordingCoordinatorError: LocalizedError {
    case alreadyRecording
    case notRecording
    case missingScreenRecordingPermission
    case noShareableDisplay
    case snapshotUnsupported
    case startFailed(String)
    case stopFailed(String)

    var errorDescription: String? {
        switch self {
        case .alreadyRecording:
            return "Recording already in progress"
        case .notRecording:
            return "No recording in progress"
        case .missingScreenRecordingPermission:
            return "System audio capture requires Screen Recording permission"
        case .noShareableDisplay:
            return "No display available for system audio capture"
        case .snapshotUnsupported:
            return "System audio recording does not support realtime snapshots"
        case .startFailed(let message):
            return message
        case .stopFailed(let message):
            return message
        }
    }
}

final class RecordingCoordinator {
    static let shared = RecordingCoordinator()

    private var activeSource: RecordingSource?

    private init() {}

    @MainActor
    func startRecording(source: RecordingSource) async throws {
        guard activeSource == nil else {
            throw RecordingCoordinatorError.alreadyRecording
        }

        switch source {
        case .microphone:
            guard RecordingHelper.shared.startRecording() else {
                throw RecordingCoordinatorError.startFailed("Failed to start recording")
            }
        case .systemAudio:
            try await SystemAudioRecordingHelper.shared.startRecording()
        }

        activeSource = source
    }

    @MainActor
    func stopRecording() async throws -> String? {
        guard let source = activeSource else {
            throw RecordingCoordinatorError.notRecording
        }

        let filePath: String?
        switch source {
        case .microphone:
            filePath = RecordingHelper.shared.stopRecording()
        case .systemAudio:
            filePath = try await SystemAudioRecordingHelper.shared.stopRecording()
        }

        activeSource = nil
        return filePath
    }

    @MainActor
    func snapshotRecording() async throws -> String? {
        switch activeSource {
        case .microphone, .none:
            return RecordingHelper.shared.snapshotRecording()
        case .systemAudio:
            throw RecordingCoordinatorError.snapshotUnsupported
        }
    }

    @MainActor
    func cancelRecording() async {
        let source = activeSource
        activeSource = nil

        switch source {
        case .microphone:
            RecordingHelper.shared.cancelRecording()
        case .systemAudio:
            await SystemAudioRecordingHelper.shared.cancelRecording()
        case .none:
            break
        }
    }

    func setHarvestMode(_ mode: String, silenceMs: Int?) {
        if activeSource != .systemAudio {
            RecordingHelper.shared.setHarvestMode(mode, silenceMs: silenceMs)
        }
    }
}

final class SystemAudioRecordingHelper: NSObject, SCStreamOutput {
    static let shared = SystemAudioRecordingHelper()

    private let sampleQueue = DispatchQueue(label: "FieldTheoryHelper.SystemAudio")
    private let targetFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: 16_000,
        channels: 1,
        interleaved: false
    )!
    private static let wavSettings: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatLinearPCM),
        AVSampleRateKey: 16000,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 32,
        AVLinearPCMIsFloatKey: true,
        AVLinearPCMIsBigEndianKey: false
    ]

    private var stream: SCStream?
    private var audioFile: AVAudioFile?
    private var recordingURL: URL?
    private var isRecording = false

    private override init() {
        super.init()
    }

    @MainActor
    func startRecording() async throws {
        guard !isRecording else {
            throw RecordingCoordinatorError.alreadyRecording
        }

        guard CGPreflightScreenCaptureAccess() else {
            throw RecordingCoordinatorError.missingScreenRecordingPermission
        }

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw RecordingCoordinatorError.noShareableDisplay
        }

        let tempDir = FileManager.default.temporaryDirectory
        let fileName = "fieldtheory-system-audio-\(UUID().uuidString).wav"
        let url = tempDir.appendingPathComponent(fileName)
        let file = try AVAudioFile(forWriting: url, settings: Self.wavSettings)

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        configuration.excludesCurrentProcessAudio = true
        configuration.sampleRate = 16_000
        configuration.channelCount = 1
        configuration.width = 2
        configuration.height = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.queueDepth = 2
        configuration.showsCursor = false

        let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)

        self.audioFile = file
        self.recordingURL = url
        self.stream = stream
        self.isRecording = true

        do {
            try await startCapture(stream)
            sendLog(level: "info", message: "System audio recording started: \(url.path)")
        } catch {
            self.isRecording = false
            self.audioFile = nil
            self.recordingURL = nil
            self.stream = nil
            try? FileManager.default.removeItem(at: url)
            throw error
        }
    }

    @MainActor
    func stopRecording() async throws -> String? {
        guard isRecording, let stream = stream, let url = recordingURL else {
            throw RecordingCoordinatorError.notRecording
        }

        isRecording = false
        self.stream = nil
        self.audioFile = nil
        self.recordingURL = nil

        try? stream.removeStreamOutput(self, type: .audio)
        do {
            try await stopCapture(stream)
        } catch {
            throw RecordingCoordinatorError.stopFailed(error.localizedDescription)
        }

        let path = url.path
        if !FileManager.default.fileExists(atPath: path) {
            throw RecordingCoordinatorError.stopFailed("Recording file does not exist")
        }

        return path
    }

    @MainActor
    func cancelRecording() async {
        guard let stream = stream else {
            return
        }

        let url = recordingURL
        isRecording = false
        self.stream = nil
        self.audioFile = nil
        self.recordingURL = nil

        try? stream.removeStreamOutput(self, type: .audio)
        _ = try? await stopCapture(stream)

        if let url {
            try? FileManager.default.removeItem(at: url)
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .audio, isRecording, CMSampleBufferDataIsReady(sampleBuffer) else {
            return
        }

        guard
            let inputBuffer = pcmBuffer(from: sampleBuffer),
            let bufferToWrite = convertToTargetFormatIfNeeded(inputBuffer),
            let audioFile = audioFile
        else {
            return
        }

        do {
            try audioFile.write(from: bufferToWrite)
        } catch {
            sendLog(level: "error", message: "Failed to write system audio buffer: \(error.localizedDescription)")
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        sendLog(level: "error", message: "System audio capture stopped: \(error.localizedDescription)")
    }

    private func startCapture(_ stream: SCStream) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            stream.startCapture { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }

    private func stopCapture(_ stream: SCStream) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            stream.stopCapture { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }

    private func convertToTargetFormatIfNeeded(_ inputBuffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        if inputBuffer.format.sampleRate == targetFormat.sampleRate,
           inputBuffer.format.channelCount == targetFormat.channelCount,
           inputBuffer.format.commonFormat == targetFormat.commonFormat,
           inputBuffer.format.isInterleaved == targetFormat.isInterleaved {
            return inputBuffer
        }

        guard let converter = AVAudioConverter(from: inputBuffer.format, to: targetFormat) else {
            return nil
        }

        let ratio = targetFormat.sampleRate / inputBuffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(inputBuffer.frameLength) * ratio).rounded(.up))
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: max(capacity, 1)) else {
            return nil
        }

        var error: NSError?
        var didProvideInput = false
        let status = converter.convert(to: outputBuffer, error: &error) { _, outStatus in
            if didProvideInput {
                outStatus.pointee = .noDataNow
                return nil
            }
            didProvideInput = true
            outStatus.pointee = .haveData
            return inputBuffer
        }

        if status == .error || error != nil {
            return nil
        }

        return outputBuffer
    }

    private func pcmBuffer(from sampleBuffer: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard
            let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
            let streamDescription = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription),
            let format = AVAudioFormat(streamDescription: streamDescription)
        else {
            return nil
        }

        let frameCount = AVAudioFrameCount(CMSampleBufferGetNumSamples(sampleBuffer))
        guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
            return nil
        }
        pcmBuffer.frameLength = frameCount

        var audioBufferList = AudioBufferList(
            mNumberBuffers: 1,
            mBuffers: AudioBuffer(mNumberChannels: format.channelCount, mDataByteSize: 0, mData: nil)
        )
        var blockBuffer: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: &audioBufferList,
            bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer
        )

        guard status == noErr else {
            return nil
        }

        let sourceBuffers = UnsafeMutableAudioBufferListPointer(&audioBufferList)
        let destinationBuffers = UnsafeMutableAudioBufferListPointer(pcmBuffer.mutableAudioBufferList)
        for index in 0..<min(sourceBuffers.count, destinationBuffers.count) {
            guard let sourceData = sourceBuffers[index].mData, let destinationData = destinationBuffers[index].mData else {
                continue
            }
            memcpy(destinationData, sourceData, Int(min(sourceBuffers[index].mDataByteSize, destinationBuffers[index].mDataByteSize)))
        }

        return pcmBuffer
    }
}
