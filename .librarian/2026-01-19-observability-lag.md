# The Observer's Delay

*Context: Fixing hook system where the mechanism worked but the display didn't update*

In 1927, Heisenberg formalized what engineers had known implicitly: observation and reality operate on different timescales. The hook script writes to `.status.json` in real-time, the bash shell executing atomically via jq. But the Electron renderer—compiled TypeScript, bundled JavaScript, React's reconciliation loop—runs on stale bytecode. The measurement apparatus (the UI) lags behind the phenomenon (the file).

This is the classic split-brain problem in distributed systems. Werner Vogels at Amazon called it "eventual consistency" when describing DynamoDB in 2007, but the pattern is older. The file system is the source of truth; the application is a cached view. When we modified `librarianManager.ts` but didn't rebuild, we created a system where the hook (bash, interpreted) evolved while the observer (TypeScript, compiled) remained frozen. The fix isn't clever architecture—it's `npm run build`. Sometimes the gap between intention and observation closes only through recompilation.
