import SwiftUI

@main
struct FieldTheoryNativeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()

    var body: some Scene {
        MenuBarExtra("Field Theory", systemImage: model.transcriptionState.menuBarSymbolName) {
            MenuBarContentView()
                .environmentObject(model)
        }

        Window("Clipboard History", id: AppWindow.clipboardHistory.rawValue) {
            ClipboardHistoryView()
                .environmentObject(model)
        }
        .defaultSize(width: 960, height: 680)

        Window("Command Launcher", id: AppWindow.commandLauncher.rawValue) {
            CommandLauncherView()
                .environmentObject(model)
        }
        .defaultSize(width: 600, height: 420)

        Settings {
            SettingsRootView()
                .environmentObject(model)
        }
    }
}
