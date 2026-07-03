import AVFoundation
import Foundation
import whisper

struct WhisperError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Thin actor around the whisper.cpp C API (linked via whisper.xcframework
/// built from this repo). Fully offline; Metal-accelerated.
actor WhisperService {
    private var context: OpaquePointer?
    private var loadedModelPath: String?

    /// Slice long recordings so memory stays bounded; 10 minutes of 16 kHz
    /// floats is ~38 MB per slice.
    private let sliceSeconds: Double = 600

    private func ensureContext(modelURL: URL) throws {
        let path = modelURL.path
        if context != nil, loadedModelPath == path { return }
        if let context { whisper_free(context) }
        var params = whisper_context_default_params()
        params.use_gpu = true
        guard let newContext = whisper_init_from_file_with_params(path, params) else {
            throw WhisperError(message: "Could not load speech model")
        }
        context = newContext
        loadedModelPath = path
    }

    func transcribe(audioURL: URL, modelURL: URL) throws -> String {
        try ensureContext(modelURL: modelURL)
        guard let context else { throw WhisperError(message: "No model loaded") }

        let samples = try Self.loadSamples(from: audioURL)
        guard !samples.isEmpty else { return "" }

        let sliceLength = Int(sliceSeconds * 16000)
        var pieces: [String] = []
        var cursor = 0
        while cursor < samples.count {
            let end = min(cursor + sliceLength, samples.count)
            let slice = Array(samples[cursor..<end])
            pieces.append(try run(on: context, samples: slice))
            cursor = end
        }
        return pieces.joined(separator: " ")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func run(on context: OpaquePointer, samples: [Float]) throws -> String {
        var params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
        params.print_realtime = false
        params.print_progress = false
        params.print_timestamps = false
        params.print_special = false
        params.translate = false
        params.no_context = true
        params.single_segment = false
        params.suppress_blank = true
        params.n_threads = Int32(max(2, min(8, ProcessInfo.processInfo.processorCount - 2)))

        let status = "en".withCString { language -> Int32 in
            params.language = language
            return samples.withUnsafeBufferPointer { buffer in
                whisper_full(context, params, buffer.baseAddress, Int32(buffer.count))
            }
        }
        guard status == 0 else { throw WhisperError(message: "whisper_full failed (\(status))") }

        var text = ""
        for index in 0..<whisper_full_n_segments(context) {
            if let segment = whisper_full_get_segment_text(context, index) {
                text += String(cString: segment)
            }
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Reads any audio file into 16 kHz mono Float32 samples.
    private static func loadSamples(from url: URL) throws -> [Float] {
        let file = try AVAudioFile(forReading: url)
        guard let targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false) else {
            throw WhisperError(message: "Bad audio format")
        }

        if file.processingFormat.sampleRate == 16000, file.processingFormat.channelCount == 1 {
            guard let buffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: AVAudioFrameCount(file.length)) else {
                throw WhisperError(message: "Could not allocate audio buffer")
            }
            try file.read(into: buffer)
            return samples(from: buffer)
        }

        // Resample via AVAudioConverter.
        guard let inputBuffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)) else {
            throw WhisperError(message: "Could not allocate audio buffer")
        }
        try file.read(into: inputBuffer)
        guard let converter = AVAudioConverter(from: file.processingFormat, to: targetFormat) else {
            throw WhisperError(message: "Could not convert audio")
        }
        let ratio = 16000 / file.processingFormat.sampleRate
        let capacity = AVAudioFrameCount(Double(inputBuffer.frameLength) * ratio + 1024)
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else {
            throw WhisperError(message: "Could not allocate audio buffer")
        }
        var fed = false
        converter.convert(to: outputBuffer, error: nil) { _, status in
            if fed {
                status.pointee = .endOfStream
                return nil
            }
            fed = true
            status.pointee = .haveData
            return inputBuffer
        }
        return samples(from: outputBuffer)
    }

    private static func samples(from buffer: AVAudioPCMBuffer) -> [Float] {
        guard let channel = buffer.floatChannelData?[0] else { return [] }
        return Array(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
    }
}
