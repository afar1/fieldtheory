import Foundation
import AVFoundation

/// Capture-only PCM mixing. No player, output node, device volume, or hardware render clock.
public final class CaptureAudioPipeline: @unchecked Sendable {
    public enum Source { case microphone, system }
    private var statistics: [String: Int] = ["microphoneFrames": 0, "systemFrames": 0,
        "microphoneNonzero": 0, "systemNonzero": 0, "lateMicrophoneFrames": 0,
        "lateSystemFrames": 0, "outputFrames": 0, "outputNonzero": 0]
    private let queue = DispatchQueue(label: "FieldTheory.CaptureWriter", qos: .userInitiated)
    private let lock = NSLock()
    private var active = true
    private var pendingFrames = 0
    private let mixed: Bool
    private let origin: Double
    private let consume: (AVAudioPCMBuffer) -> Void
    private let format = AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1)!
    // Allow 500 ms for HFP-sized callbacks plus device latency. A missing source cannot stall the other indefinitely.
    private let skew: Int64 = 8_000
    private let capacity = 32_768
    private var ring = [Float](repeating: 0, count: 32_768)
    private var cursor: Int64 = 0
    private var micEnd: Int64 = 0
    private var systemEnd: Int64 = 0

    public init(mixed: Bool, origin: Double, consume: @escaping (AVAudioPCMBuffer) -> Void) {
        self.mixed = mixed; self.origin = origin; self.consume = consume
    }

    /// Bounds queued work to one second even if writing or downstream processing stalls.
    @discardableResult
    public func append(_ buffer: AVAudioPCMBuffer, source: Source, at seconds: Double) -> Bool {
        guard buffer.format.sampleRate == 16_000, buffer.format.channelCount == 1,
              buffer.format.commonFormat == .pcmFormatFloat32, buffer.floatChannelData != nil,
              seconds.isFinite else { return false }
        let frames = Int(buffer.frameLength)
        guard frames > 0, frames <= 16_000 else { return false }
        lock.lock()
        guard active, pendingFrames + frames <= 16_000 else { lock.unlock(); return false }
        pendingFrames += frames
        // AVAudioEngine owns its tap buffer: copy before returning from the callback.
        let samples = Array(UnsafeBufferPointer(start: buffer.floatChannelData![0], count: frames))
        queue.async {
            defer { self.lock.lock(); self.pendingFrames -= frames; self.lock.unlock() }
            let key = source == .microphone ? "microphone" : "system"
            self.statistics[key + "Frames", default: 0] += frames
            self.statistics[key + "Nonzero", default: 0] += samples.reduce(0) { $0 + ($1 == 0 ? 0 : 1) }
            if !self.mixed { self.emit(samples); return }
            self.mix(samples, source: source, at: seconds)
        }
        lock.unlock()
        return true
    }

    /// File rotation uses the same serial owner as writes. Pending alignment tail belongs to the next file.
    public func synchronize<T>(_ operation: () throws -> T) rethrows -> T { try queue.sync(execute: operation) }

    @discardableResult
    public func finish() -> [String: Int] {
        lock.lock(); active = false; lock.unlock()
        return queue.sync {
            if mixed { flush(through: max(micEnd, systemEnd)) }
            return statistics
        }
    }

    private func mix(_ samples: [Float], source: Source, at seconds: Double) {
        let offset = (seconds - origin) * 16_000
        guard offset >= Double(Int64.min / 2), offset <= Double(Int64.max / 2) else { return }
        let start = Int64(offset.rounded())
        let end = start + Int64(samples.count)
        // The timeline can jump after sleep/device loss; retain pending speech without allocating a gap-sized buffer.
        if start - cursor > Int64(capacity - samples.count) {
            flush(through: max(micEnd, systemEnd))
            cursor = start
        }
        let late = max(0, min(end, cursor) - max(start, 0))
        statistics[source == .microphone ? "lateMicrophoneFrames" : "lateSystemFrames", default: 0] += Int(late)
        let previousEnd = source == .microphone ? micEnd : systemEnd
        let first = max(start, cursor, previousEnd)
        if first < end {
            for frame in first..<end {
                ring[Int(frame % Int64(capacity))] += samples[Int(frame - start)]
            }
        }
        if source == .microphone { micEnd = max(micEnd, end) } else { systemEnd = max(systemEnd, end) }
        flush(through: max(min(micEnd, systemEnd), max(micEnd, systemEnd) - skew))
    }

    private func flush(through end: Int64) {
        while cursor < end {
            let count = Int(min(1_024, end - cursor))
            var samples = [Float](repeating: 0, count: count)
            for i in 0..<count {
                let index = Int((cursor + Int64(i)) % Int64(capacity))
                // Float WAV retains headroom, but keep the ASR input in its expected range.
                samples[i] = max(-1, min(1, ring[index]))
                ring[index] = 0
            }
            cursor += Int64(count)
            emit(samples)
        }
    }

    private func emit(_ samples: [Float]) {
        guard !samples.isEmpty, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)) else { return }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { buffer.floatChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
        statistics["outputFrames", default: 0] += samples.count
        statistics["outputNonzero", default: 0] += samples.reduce(0) { $0 + ($1 == 0 ? 0 : 1) }
        consume(buffer)
    }
}
