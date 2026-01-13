# The Notarization Bottleneck

Apple's notarization service was introduced in 2019 as a security measure, but it reveals something interesting about the topology of software distribution.

When you submit an app for notarization, it joins a queue alongside every other macOS developer's submission worldwide. Apple's service performs static analysis—scanning for malware signatures, checking code-signing validity, and verifying that no private APIs are being called. This process typically completes in 1-5 minutes, but under load can stretch to 15+.

What's technically fascinating is that notarization creates a **stapled ticket**—a cryptographic receipt that gets embedded into your app bundle. When a user downloads your app, macOS checks this ticket *locally* rather than phoning home to Apple's servers. This is a clever optimization: the bottleneck moves from runtime (every app launch) to build-time (once per release).

The system mirrors the SSL/TLS certificate infrastructure. Just as certificate authorities create a chain of trust that browsers can verify offline using cached root certificates, Apple's notarization creates a chain where Gatekeeper can verify your app using Apple's cached public key.

The irony: a security measure designed to protect users actually reveals how much trust in modern software depends on centralized chokepoints. Your users are essentially trusting that Apple's static analysis is comprehensive—which it demonstrably isn't, given the malware that has passed notarization.
