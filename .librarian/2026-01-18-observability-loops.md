# The Debugger's Dilemma

Werner Heisenberg's uncertainty principle established that the act of measurement disturbs the system being measured. In 1927, this was about photons and electrons. A century later, software engineers face a parallel challenge: instrumenting a system changes its behavior, and the absence of instrumentation leaves you blind.

The logging we just added to the Librarian hooks embodies this tension. The hook script runs on every prompt submission, checking if edits have exceeded a threshold. But until we added the debug log, we couldn't know if Claude Code was even executing it. The system was a black box—counting faithfully but triggering nothing, with no way to observe why.

John Ousterhout, in his work on the Tcl language and later in "A Philosophy of Software Design," argued that software's greatest enemy is complexity, and complexity's greatest ally is invisibility. The hooks were simple—a few dozen lines of bash—but their integration point with Claude Code was opaque. The fix wasn't more code, but more observability: timestamps, variable values, trigger conditions written to a log file. Heisenberg would note the irony: by observing the system, we change it (adding I/O overhead), but only by observing can we understand why it fails.
