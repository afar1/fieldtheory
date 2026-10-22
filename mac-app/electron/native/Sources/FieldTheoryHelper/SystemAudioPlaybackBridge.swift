import Foundation
import AVFoundation

// Bound the bridge to one second so a stalled render graph cannot grow a call-length queue.
// Queue accounting and completion ownership are protected by lock; the player schedules audio on its render thread.
final class SystemAudioPlaybackBridge: @unchecked Sendable {
    private let player: AVAudioPlayerNode
    private let lock = NSLock()
    private var queuedFrames: AVAudioFrameCount = 0
    private var active = true
    private var drainCompletion: ((Bool) -> Void)?
    init(player: AVAudioPlayerNode) { self.player = player }
    func start() { player.play() }
    func stop() {
        lock.lock()
        active = false
        lock.unlock()
        player.stop()
        completeDrain(success: false)
    }
    func finish() async -> Bool {
        await withCheckedContinuation { continuation in
            lock.lock()
            if !active {
                lock.unlock()
                continuation.resume(returning: false)
                return
            }
            if queuedFrames == 0 {
                lock.unlock()
                continuation.resume(returning: true)
                return
            }
            drainCompletion = { continuation.resume(returning: $0) }
            lock.unlock()
            DispatchQueue.global().asyncAfter(deadline: .now() + 2) { [weak self] in
                self?.completeDrain(success: false)
            }
        }
    }
    private func completeDrain(success: Bool) {
        lock.lock()
        let completion = drainCompletion
        drainCompletion = nil
        lock.unlock()
        completion?(success)
    }
    func enqueue(_ buffer: AVAudioPCMBuffer) -> Bool {
        let frames = buffer.frameLength
        lock.lock()
        guard active, queuedFrames + frames <= 16_000 else { lock.unlock(); return false }
        queuedFrames += frames
        lock.unlock()
        player.scheduleBuffer(buffer, completionCallbackType: .dataRendered) { [weak self] _ in
            guard let self else { return }
            self.lock.lock()
            self.queuedFrames -= frames
            let drained = self.queuedFrames == 0
            self.lock.unlock()
            if drained { self.completeDrain(success: true) }
        }
        return true
    }
}

