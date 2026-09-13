import SwiftUI
import UIKit

final class FieldTheoryAppDelegate: NSObject, UIApplicationDelegate {
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
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(.accentColor)
                .onChange(of: scenePhase) { _, phase in
                    model.sync.setForeground(phase == .active)
                    if phase == .active { model.handleDidBecomeActive() }
                }
        }
    }
}
