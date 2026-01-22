# The Explicit State Principle

⠀⠀⠀⠀⠀⠀⠀⠀⣀⣤⣤⣤⣤⣤⣤⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⣠⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⣠⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⣴⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣦⠀⠀⠀⠀⠀⠀⠀⠀
⠀⣼⣿⣿⣿⠏⠀⠀⢠⣾⣷⡄⠀⠀⣴⣿⣦⠀⠀⠹⣿⣿⣧⠀⠀⠀⠀⠀⠀⠀
⠀⣿⣿⣿⣿⠀⠀⠀⣿⣿⣿⣿⠀⠀⣿⣿⣿⡇⠀⠀⣿⣿⣿⡇⠀⣿⣿⣿⣿⠀
⠀⣿⣿⣿⣿⡄⠀⠀⠹⣿⣿⠏⠀⠀⠹⣿⣿⠃⠀⢀⣿⣿⣿⡇⠀⣿⣿⣿⣿⠀
⠀⢻⣿⣿⣿⣿⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣿⣿⣿⣿⠃⠀⠀⠀⠀⠀⠀
⠀⠀⠻⣿⣿⣿⣿⣿⣶⣤⣀⣀⣀⣀⣤⣶⣿⣿⣿⣿⣿⠿⠃⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠈⠛⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠛⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠈⠙⠛⠛⠿⠿⠿⠿⠛⠛⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣀⣀⣀⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⣿⣿⣿⣿⡿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠉⠉⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀

In 1962, the Mariner 1 spacecraft veered off course 293 seconds after launch and had to be destroyed. The cause: a missing overbar in a handwritten formula, transcribed as a period instead of a smoothing function. The guidance computer trusted its internal representation of velocity data rather than the explicit sensor readings, and a single ambiguous symbol cascaded into a $18.5 million failure. NASA's postmortem established what became known as the "explicit parameter principle"—when two systems must agree on state, pass the value directly rather than assuming synchronization.

The same principle appears in distributed systems theory as the distinction between "shared state" and "message passing." Leslie Lamport's work on logical clocks demonstrated that processes cannot reliably infer each other's state; they must communicate it explicitly. When a client holds a session token and a server holds its own copy, the question is not which is authoritative—it's whether they can agree without inference. The defensive choice is always to pass what you have rather than ask what the other remembers. This eliminates an entire class of desynchronization bugs and, crucially, fails gracefully when the channel between them is unavailable. The offline user retains their local truth; reconciliation happens when connection returns.
