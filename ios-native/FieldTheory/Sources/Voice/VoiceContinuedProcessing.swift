import BackgroundTasks
import UIKit
import OSLog

@MainActor
protocol VoiceProcessingTask: AnyObject {
    var progress: Progress { get }
    func onExpiration(_ handler: @escaping @Sendable () -> Void)
    func complete(success: Bool)
}

extension BGContinuedProcessingTask: VoiceProcessingTask {
    func onExpiration(_ handler: @escaping @Sendable () -> Void) { expirationHandler = handler }
    func complete(success: Bool) { setTaskCompleted(success: success) }
}

@MainActor
protocol VoiceProcessingScheduler {
    func register(_ handler: @escaping @MainActor (any VoiceProcessingTask) -> Void) -> Bool
    func submit() throws
}

@MainActor
private struct SystemVoiceProcessingScheduler: VoiceProcessingScheduler {
    func register(_ handler: @escaping @MainActor (any VoiceProcessingTask) -> Void) -> Bool {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: VoiceContinuedProcessing.identifier, using: .main) { task in
            Task { @MainActor in
                guard let continued = task as? BGContinuedProcessingTask else {
                    task.setTaskCompleted(success: false)
                    return
                }
                handler(continued)
            }
        }
    }

    func submit() throws {
        let request = BGContinuedProcessingTaskRequest(
            identifier: VoiceContinuedProcessing.identifier,
            title: "Transcribing recording",
            subtitle: "Converting audio to text on this device"
        )
        request.strategy = .fail
        try BGTaskScheduler.shared.submit(request)
    }
}

/// One foreground user action owns one system task. Automatic queue recovery
/// deliberately does not submit user-visible background work.
@MainActor
final class VoiceContinuedProcessing {
    static let shared = VoiceContinuedProcessing()
    static let identifier = "com.afar1.fieldtheory.voice.transcription"
    typealias Operation = @MainActor (Progress, Bool) async -> Bool
    private var operation: Operation?
    private var completion: CheckedContinuation<Void, Never>?
    private var worker: Task<Void, Never>?
    private let logger = Logger(subsystem: "com.afar1.fieldtheory", category: "VoiceBackground")
    private let scheduler: any VoiceProcessingScheduler
    private let isForeground: () -> Bool
    private lazy var registered = scheduler.register { [weak self] task in
        guard let self else { task.complete(success: false); return }
        launch(task)
    }

    init(scheduler: (any VoiceProcessingScheduler)? = nil,
         isForeground: @escaping () -> Bool = { UIApplication.shared.applicationState == .active }) {
        self.scheduler = scheduler ?? SystemVoiceProcessingScheduler()
        self.isForeground = isForeground
    }

    func run(_ operation: @escaping Operation) async {
        guard self.operation == nil else { return }
        guard isForeground(), registered else {
            _ = await operation(Progress(totalUnitCount: 1000), false)
            return
        }
        self.operation = operation
        await withCheckedContinuation { continuation in
            completion = continuation
            do {
                try scheduler.submit()
            } catch {
                // Refusal must not prevent foreground transcription.
                logger.notice("Continued transcription unavailable: \(error.localizedDescription, privacy: .public)")
                worker = Task { @MainActor in
                    _ = await operation(Progress(totalUnitCount: 1000), false)
                    finish()
                }
            }
        }
    }

    private func launch(_ task: any VoiceProcessingTask) {
        guard let operation, worker == nil else {
            task.complete(success: false)
            return
        }
        task.progress.totalUnitCount = 1000
        let work = Task { @MainActor in
            logger.info("Continued transcription started")
            let succeeded = await operation(task.progress, true)
            logger.info("Continued transcription finished success=\(succeeded && !Task.isCancelled, privacy: .public) background=\(UIApplication.shared.applicationState == .background, privacy: .public)")
            if succeeded && !Task.isCancelled { task.progress.completedUnitCount = task.progress.totalUnitCount }
            task.complete(success: succeeded && !Task.isCancelled)
            finish()
        }
        worker = work
        task.onExpiration { work.cancel() }
    }

    private func finish() {
        worker = nil
        operation = nil
        let continuation = completion
        completion = nil
        continuation?.resume()
    }
}
