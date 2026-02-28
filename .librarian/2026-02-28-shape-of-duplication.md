# The Shape of Duplication

In 1968, Melvin Conway observed that organizations produce systems whose structure mirrors their communication patterns. Less discussed is the temporal version of this law: codebases duplicate in the shape of their growth timeline.

When you add a second thing that works like the first thing, you copy-paste. It's the rational choice — the first thing works, and you don't yet know what the shared abstraction should be. You can't generalize from a single example. As Rich Hickey put it: "Duplication is far cheaper than the wrong abstraction."

But the moment you can see the shape — the moment you've built the second instance and can diff it against the first — you have the information you lacked. The Qwen server and the MLX Whisper server shared ~170 lines of identical lifecycle management: spawn a process, buffer stdout lines, watch for a JSON ready signal, serialize commands through a single pending resolver, kill on SIGTERM. The only differences were string labels and a single pre-start validation hook.

The `StdioJsonServer` class that replaces both is 275 lines — larger than either individual copy. But it's 275 lines in one place instead of 170 × 2 in two places. And crucially, the third engine (or fourth, or fifth) costs 5 lines instead of 170. The marginal cost of the next instance dropped from O(n) to O(1).

This is the essence of the DRY principle as originally stated by Hunt and Thomas in *The Pragmatic Programmer* (1999): "Every piece of knowledge must have a single, unambiguous, authoritative representation within a system." Not "never repeat a line of code" — that's the bastardized version that leads to premature abstraction. The real principle is about *knowledge*. The knowledge of "how to manage a persistent JSON subprocess" existed in two places. Now it exists in one.

The same pattern played out in the shell scripts. The Python-finding logic — scanning Homebrew paths, probing version ranges, testing MLX wheel resolution — was identical across `setup-qwen.sh` and `setup-mlx-whisper.sh`. One `source` statement and ~100 lines vanish from each.

What's worth noting is the timing. The refactoring happened immediately after the second engine was added — not during, not weeks later. This is the window where the cost of extraction is lowest, because the duplicate shapes are fresh in working memory. Wait too long and the copies drift, accumulate engine-specific hacks, and the extraction becomes archaeology.
