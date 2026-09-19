import SwiftUI
import UIKit

final class FieldTheoryAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        VoiceModelPreparation.shared.register()
        return true
    }

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        ParakeetBackgroundDownloader.shared.handleEvents(
            for: identifier, completionHandler: completionHandler)
    }
}

@main
struct FieldTheoryApp: App {
    @UIApplicationDelegateAdaptor(FieldTheoryAppDelegate.self) private var appDelegate
    @State private var model = AppModel.shared
    @State private var recordingOnNextOpen = !ProcessInfo.processInfo.arguments.contains("--prepare-voice-model")
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(.accentColor)
                .onChange(of: scenePhase, initial: true) { _, phase in
                    model.sync.setForeground(phase == .active)
                    if phase == .background {
                        recordingOnNextOpen = true
                        VoiceModelPreparation.shared.schedule()
                    }
                    if phase == .active {
                        Task { await BackgroundRecordingSession.shared.dismissCompletedActivities() }
                        model.handleDidBecomeActive()
                        if recordingOnNextOpen {
                            recordingOnNextOpen = false
                            Task { await model.startRecordingIfEnabledOnOpen() }
                        }
                    }
                }
        }
    }
}
