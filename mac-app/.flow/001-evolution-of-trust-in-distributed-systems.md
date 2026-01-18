# The Evolution of Trust in Distributed Systems

*Reading time: ~4 minutes*
*Context: Auth architecture refactoring - single source of truth*

## The Problem of Shared Secrets

In 1961, MIT's Compatible Time-Sharing System (CTSS) introduced the first computer password. Fernando Corbató needed a way to let multiple users share one IBM 7094 while keeping their files private. His solution was elegant: each user had a secret string stored in a master file. Type the right string, gain access.

This created the first "session" problem. How long should access last? CTSS solved it simply—you stayed logged in until you logged out or the terminal timed out. One machine, one user at a time, one source of truth.

## The Token Revolution

By the 1990s, the web broke this model. HTTP was stateless. Every request arrived fresh, with no memory of the last. Netscape's solution in 1994—cookies—was essentially Corbató's password, but repeated with every request. The server became a single source of truth that had to be consulted constantly.

Kerberos, developed at MIT in 1988, introduced a different idea: the **ticket**. Instead of checking credentials with a central authority on every request, you'd authenticate once and receive a cryptographically signed token. The token itself carried proof of identity. The server didn't need to remember you—it just needed to verify the signature.

This is the architecture your AuthManager now implements. The access token is a Kerberos ticket. The refresh token is your long-term credential. The central authority (Supabase) only needs to be consulted when the ticket expires.

## The CAP Theorem's Shadow

In 2000, Eric Brewer presented what became the CAP theorem: a distributed system can guarantee at most two of three properties—Consistency, Availability, Partition tolerance.

Your logout bug was a CAP problem in miniature. The renderer and main process each maintained session state (no single source of truth). When they disagreed—partition—you had to choose: accept inconsistency (one thinks you're logged in, one doesn't) or sacrifice availability (force logout to restore consistency).

The aggressive 5-second check chose availability sacrifice. Your refactor chooses the other path: accept temporary inconsistency (network blips don't immediately invalidate sessions) in exchange for availability (the app keeps working).

## The Apollo Precedent

The Apollo Guidance Computer faced this same tradeoff. During Apollo 11's descent, the computer threw 1202 and 1202 alarms—executive overflow, too many tasks. The software had a choice: halt to ensure consistency, or shed low-priority tasks and continue.

MIT's designers chose continuation. The landing radar data was "good enough." Neil Armstrong landed with 25 seconds of fuel remaining.

Your `scheduleRefreshRetry()` is the same philosophy. A failed token refresh isn't an emergency—it's a low-priority task that can wait 30 seconds. The user's clipboard still works. The local transcription still runs. The system degrades gracefully rather than failing completely.
