import SwiftUI

@main
struct FieldTheoryApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(.accentColor)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { model.handleDidBecomeActive() }
                }
        }
    }
}
