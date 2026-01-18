# The Focus Wars

In the early days of windowing systems, focus was simple: click a window, it comes forward. The Xerox Alto established this in 1973, and for a decade, nobody questioned it.

Then came the power users.

By the mid-1980s, Unix workstations introduced "focus follows mouse"—the window under your cursor received keystrokes without clicking. Sun Microsystems engineers loved it. They could type in one window while reading another. But it drove newcomers insane: accidentally brushing the mouse would send their keystrokes into the void.

The real complexity emerged with "focus stealing prevention." Windows XP introduced this in 2001 after users complained that background applications would grab focus mid-sentence, capturing passwords into chat windows or deleting files with stray keystrokes. The solution was elegant in theory: applications could only take focus if the user had recently interacted with them.

But what counts as "recent"? Microsoft settled on a 200-millisecond window. If you clicked something and an app tried to focus within 200ms, it could. After that, it would flash in the taskbar instead. This created a new class of bug: race conditions in focus.

macOS took a different approach with "activation policies." An application declares itself as regular (can take focus), accessory (appears in Dock but doesn't take focus automatically), or prohibited (never appears in Dock, never takes focus). Utilities like clipboard managers typically use accessory mode—they appear when summoned but vanish without disrupting your flow.

The key insight, discovered through decades of user frustration: taking focus is a privilege, not a right. The best tools appear when called and disappear without ceremony, returning you exactly where you were. The window you were typing in should still be waiting, cursor blinking, as if nothing happened.

This is the contract of the helper application: borrow attention, never steal it.
