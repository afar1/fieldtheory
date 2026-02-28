# Thermal Equilibrium and the Cost of Cold Starts

In thermodynamics, bringing a system from ambient temperature to operating temperature is never free. A gas turbine engine, for instance, requires a careful startup sequence — fuel ignition, spool-up through multiple compressor stages, thermal soak of the turbine blades — before it can do useful work. The GE F414 engine in the F/A-18 Super Hornet takes roughly 30 seconds from ignition to idle. But once at operating temperature, throttle response is nearly instantaneous. The metal is hot. The bearings are spinning. The system is *resident*.

This is the fundamental insight behind persistent inference engines. Every time whisper-cli spawns, it performs its own thermal soak: loading 466MB of GGML weights from disk, allocating GPU buffers, compiling Metal shader pipelines, building the computational graph. This takes ~500ms — an eternity when you're trying to transcribe 700ms audio chunks in real-time.

The Qwen ASR engine already understood this. Its Python server process loads the MLX model once and keeps it resident, responding to JSON commands over stdin/stdout. The model weights sit in unified memory, the computation graph is pre-compiled, and subsequent inferences skip straight to the useful work.

What's interesting is that whisper.cpp's own `whisper-server` example demonstrates the exact same principle. The model context (`whisper_context*`) is allocated once at startup and reused across HTTP requests, protected by a mutex. The Metal shader pipeline compiles once. The GGML backend allocates its scratch buffers once. Every subsequent transcription request finds a system already at operating temperature.

There's a deeper pattern here that shows up across computing: the JIT compiler that's slow on first invocation but blazing on subsequent calls. The database connection pool that amortizes TCP handshake cost. The CPU branch predictor that needs a few iterations to learn the pattern. The DNS resolver cache. The TLB. The L1 cache line that was just fetched.

In each case, the system pays a one-time cost to reach a state where incremental work is cheap. The art is knowing when to keep the engine running versus shutting it down. An aircraft carrier's nuclear reactor runs continuously — the cost of a cold start is measured in days. A car engine starts in seconds, so we accept the restart penalty.

For transcription in a desktop app, the answer lands somewhere in between: keep the model resident while the app is active, kill it on suspend to reclaim memory, restart it transparently on the next request. The user never sees the thermal soak. They just notice that their words appear on screen almost as fast as they speak them.
