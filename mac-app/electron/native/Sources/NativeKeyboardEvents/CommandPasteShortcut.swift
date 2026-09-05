import CoreGraphics
import Darwin

public enum CommandPasteShortcut {
    public static func post(
        to pid: pid_t,
        using postEvent: (CGKeyCode, Bool, CGEventFlags, pid_t) -> Bool
    ) -> Bool {
        // Keep the complete shortcut: oscar PR #233 restored Command release
        // for follow-up typing; a later paste-targeting change removed it.
        let commandDown = postEvent(0x37, true, .maskCommand, pid)
        let pasteDown = postEvent(0x09, true, .maskCommand, pid)
        // Always attempt both releases, even when an earlier event failed.
        // Do not combine these calls in a short-circuit boolean expression.
        let pasteUp = postEvent(0x09, false, .maskCommand, pid)
        let commandUp = postEvent(0x37, false, [], pid)
        return commandDown && pasteDown && pasteUp && commandUp
    }
}
