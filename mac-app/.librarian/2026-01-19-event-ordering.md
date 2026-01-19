# The Listener Must Precede the Signal

*Context: Fixing a race condition where view switching happens before the event listener is registered*

Leslie Lamport's 1978 paper "Time, Clocks, and the Ordering of Events in a Distributed System" established that in any system where components communicate asynchronously, the order of events matters more than their absolute timing. The paper introduced the "happens-before" relation: event A happens-before event B if B could have been causally influenced by A. Our bug violates this principle—the `showReading` event fires, ClipboardHistory switches views, LibrarianView mounts, but its `useEffect` hasn't registered the listener yet. The signal arrives before the listener exists.

The fix follows Lamport's insight: rather than trying to synchronize timing (adding delays, hoping the mount is fast enough), we restructure causality. ClipboardHistory captures the reading path in state *before* switching views, then passes it as a prop. React's render cycle guarantees props are available when the child mounts. We've converted an asynchronous race into a synchronous data flow—the reading path now "happens-before" LibrarianView needs it, by construction rather than by luck.
