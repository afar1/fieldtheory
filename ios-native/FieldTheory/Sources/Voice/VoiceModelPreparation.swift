import BackgroundTasks
import UIKit
import OSLog

/// Opportunistic warmup of already-downloaded models. iOS chooses when to run it.
@MainActor
final class VoiceModelPreparation {
    static let shared = VoiceModelPreparation()
    static let identifier = "com.afar1.fieldtheory.voice.prepare"
    private var registered = false
    private var activeTask: BGTask?
    private var worker: Task<Void, Never>?
    private let logger = Logger(subsystem: "com.afar1.fieldtheory", category: "VoicePreparation")

    func register() {
        guard !registered else { return }
        registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.identifier, using: .main) { task in
            Task { @MainActor in self.run(task) }
        }
    }

    func schedule() {
        let model = AppModel.shared
        guard registered, model.showMainUI, !model.isSigningOut, !model.isReviewerDemoStorage else { return }
        let request = BGProcessingTaskRequest(identifier: Self.identifier)
        request.requiresNetworkConnectivity = false
        request.requiresExternalPower = false
        request.earliestBeginDate = Date().addingTimeInterval(15 * 60)
        do { try BGTaskScheduler.shared.submit(request) }
        catch { logger.notice("Voice preparation scheduling unavailable: \(error.localizedDescription, privacy: .public)") }
    }

    private func run(_ task: BGTask) {
        guard activeTask == nil else { task.setTaskCompleted(success: false); return }
        activeTask = task
        task.expirationHandler = { [weak self, weak task] in
            Task { @MainActor in
                guard let self, let task, self.activeTask === task else { return }
                self.worker?.cancel()
                self.finish(task, success: false)
            }
        }
        worker = Task { @MainActor in
            let model = AppModel.shared
            for _ in 0..<100 {
                if !model.isPreparingStorage { break }
                do { try await Task.sleep(for: .milliseconds(50)) }
                catch { finish(task, success: false); return }
            }
            guard !Task.isCancelled, model.showMainUI, !model.isSigningOut, !model.isReviewerDemoStorage else {
                finish(task, success: false)
                return
            }
            let success = await model.recorder.prepareVoiceModelInBackground()
            finish(task, success: success && !Task.isCancelled)
        }
    }

    private func finish(_ task: BGTask, success: Bool) {
        guard activeTask === task else { return }
        activeTask = nil
        worker = nil
        task.expirationHandler = nil
        task.setTaskCompleted(success: success)
        logger.notice("Background model preparation completed: \(success)")
    }
}

/// Gives an in-progress launch warmup finite time to finish when the user leaves.
@MainActor
final class VoiceModelPreparationAllowance {
    private var identifier: UIBackgroundTaskIdentifier = .invalid
    init() {
        identifier = UIApplication.shared.beginBackgroundTask(withName: "Prepare voice model") { [weak self] in
            Task { @MainActor in self?.end() }
        }
    }
    func end() {
        guard identifier != .invalid else { return }
        UIApplication.shared.endBackgroundTask(identifier)
        identifier = .invalid
    }
}
