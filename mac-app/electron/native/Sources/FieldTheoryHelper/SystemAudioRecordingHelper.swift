import Foundation
import AVFoundation
import CoreMedia
import CoreGraphics
import ScreenCaptureKit

enum RecordingSource: String, Codable {
    case microphone = "microphone"
    case systemAudio = "system-audio"
    case microphoneAndSystemAudio = "microphone-and-system-audio"
}

enum RecordingCoordinatorError: LocalizedError {
    case alreadyRecording
    case notRecording
    case missingScreenRecordingPermission
    case noShareableDisplay
    case startFailed(String)
    case stopFailed(String)

    var errorDescription: String? {
        switch self {
        case .alreadyRecording: return "Recording already in progress"
        case .notRecording: return "No recording in progress"
        case .missingScreenRecordingPermission: return "System audio capture requires Screen Recording permission"
        case .noShareableDisplay: return "No display available for system audio capture"
        case .startFailed(let message), .stopFailed(let message): return message
        }
    }
}

final class RecordingCoordinator {
    static let shared = RecordingCoordinator()
    private var generation = UUID()
    private var activeRequestId: String?
    private var activeSource: RecordingSource?
    private init() {}

    @MainActor
    func startRecording(source: RecordingSource, requestId: String? = nil) async throws {
        guard activeSource == nil else { throw RecordingCoordinatorError.alreadyRecording }
        if source != .microphone && !CGPreflightScreenCaptureAccess() {
            throw RecordingCoordinatorError.missingScreenRecordingPermission
        }
        let session = UUID()
        generation = session
        activeRequestId = requestId
        activeSource = source
        guard RecordingHelper.shared.startRecording(
            captureMicrophone: source != .systemAudio,
            captureSystemAudio: source != .microphone
        ) else {
            activeSource = nil
            throw RecordingCoordinatorError.startFailed("Failed to start recording")
        }
        do {
            if source != .microphone, let consume = RecordingHelper.shared.systemAudioConsumer() {
                try await SystemAudioRecordingHelper.shared.startCapture(consume: consume, isCurrent: { self.generation == session })
                guard generation == session else {
                    throw RecordingCoordinatorError.startFailed("Audio capture stopped during startup")
                }
            }
        } catch {
            if generation == session {
                RecordingHelper.shared.cancelRecording()
                activeSource = nil
                activeRequestId = nil
            }
            throw error
        }
    }

    @MainActor
    func stopRecording() async throws -> String? {
        guard let source = activeSource else { throw RecordingCoordinatorError.notRecording }
        if source != .microphone { await SystemAudioRecordingHelper.shared.stopCapture() }
        if source != .microphone, let drain = RecordingHelper.shared.systemAudioDrain() {
            guard await drain() else {
                RecordingHelper.shared.disableSystemAudio()
                sendLog(level: "warn", message: "System audio drain timed out; preserving the captured recording")
                let path = RecordingHelper.shared.stopRecording()
                activeSource = nil
                activeRequestId = nil
                return path
            }
        }
        let path = RecordingHelper.shared.stopRecording()
        activeSource = nil
        activeRequestId = nil
        return path
    }

    @MainActor
    func snapshotRecording() async throws -> String? {
        return RecordingHelper.shared.snapshotRecording()
    }

    @MainActor
    func cancelRecording(requestId: String? = nil) async {
        if let requestId, requestId != activeRequestId { return }
        generation = UUID()
        if activeSource != nil && activeSource != .microphone {
            await SystemAudioRecordingHelper.shared.stopCapture()
        }
        RecordingHelper.shared.cancelRecording()
        activeSource = nil
        activeRequestId = nil
    }

    @MainActor
    func interruptSystemAudio(message: String) async {
        guard let source = activeSource, source != .microphone else { return }
        await SystemAudioRecordingHelper.shared.stopCapture()
        RecordingHelper.shared.disableSystemAudio()
        let detail = source == .systemAudio
            ? "System audio stopped. Finish recording to transcribe the audio already captured."
            : "System audio stopped; microphone capture continues. Finish recording to keep the captured audio."
        sendJSON(["type": "recordingCaptureInterrupted", "message": "\(detail) \(message)"])
    }

    func setHarvestMode(_ mode: String, silenceMs: Int?) {
        RecordingHelper.shared.setHarvestMode(mode, silenceMs: silenceMs)
    }
}

final class SystemAudioRecordingHelper: NSObject, SCStreamOutput, SCStreamDelegate {
    static let shared = SystemAudioRecordingHelper()
    private let sampleQueue = DispatchQueue(label: "FieldTheoryHelper.SystemAudio")
    private let targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!
    private var converter: AVAudioConverter?
    private var stream: SCStream?
    private var consume: ((AVAudioPCMBuffer) -> Bool)?
    private var sampleStream: SCStream?

    @MainActor
    func startCapture(consume: @escaping (AVAudioPCMBuffer) -> Bool, isCurrent: @escaping @MainActor () -> Bool) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard isCurrent() else { throw RecordingCoordinatorError.startFailed("Recording start cancelled") }
        guard let display = content.displays.first else { throw RecordingCoordinatorError.noShareableDisplay }
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
        let capture = SCStream(filter: filter, configuration: configuration, delegate: self)
        try capture.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)
        sampleQueue.sync { self.consume = consume; self.sampleStream = capture }
        stream = capture
        do {
            try await startCapture(capture)
            if !isCurrent() {
                try? await stopCapture(capture)
                throw RecordingCoordinatorError.startFailed("Recording start cancelled")
            }
        } catch {
            sampleQueue.sync {
                if self.sampleStream === capture { self.consume = nil; self.converter = nil; self.sampleStream = nil }
            }
            if stream === capture { stream = nil }
            throw error
        }
    }

    @MainActor
    func stopCapture() async {
        guard let capture = stream else { return }
        stream = nil
        try? await stopCapture(capture)
        try? capture.removeStreamOutput(self, type: .audio)
        sampleQueue.sync {
            if sampleStream === capture { consume = nil; converter = nil; sampleStream = nil }
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard sampleStream === stream, outputType == .audio, CMSampleBufferDataIsReady(sampleBuffer), let consume,
              let input = pcmBuffer(from: sampleBuffer), let buffer = convertToTargetFormatIfNeeded(input) else { return }
        if !consume(buffer) {
            failCapture(stream, message: "System audio could not keep up with capture; recording stopped")
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        failCapture(stream, message: error.localizedDescription)
    }

    private func failCapture(_ stream: SCStream, message: String) {
        Task { @MainActor in
            guard self.stream === stream else { return }
            await RecordingCoordinator.shared.interruptSystemAudio(message: message)
        }
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

        if converter?.inputFormat.isEqual(inputBuffer.format) != true {
            converter = AVAudioConverter(from: inputBuffer.format, to: targetFormat)
        }
        guard let converter else { return nil }

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

        var listSize = 0
        let sizeStatus = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer, bufferListSizeNeededOut: &listSize, bufferListOut: nil, bufferListSize: 0,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: nil
        )
        guard (sizeStatus == noErr || listSize > 0), listSize > 0 else { return nil }
        let storage = UnsafeMutableRawPointer.allocate(byteCount: listSize, alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { storage.deallocate() }
        let list = storage.bindMemory(to: AudioBufferList.self, capacity: 1)
        var blockBuffer: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer, bufferListSizeNeededOut: nil, bufferListOut: list, bufferListSize: listSize,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: &blockBuffer
        )
        guard status == noErr else { return nil }
        let sourceBuffers = UnsafeMutableAudioBufferListPointer(list)
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
