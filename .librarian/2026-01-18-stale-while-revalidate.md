# The Useful Lie of Stale Data

In 1999, the HTTP/1.1 specification introduced cache-control headers that forced a binary choice: data was either fresh or it wasn't. If your cache expired, you waited. The connection between user intent and server response was treated as sacred—an unbroken chain of truth.

This proved terrible for user experience.

Mark Nottingham, while working on HTTP caching semantics, proposed `stale-while-revalidate` in 2010. The insight was deceptively simple: most stale data is still *useful* data. A weather forecast from 30 seconds ago is virtually identical to one from right now. Your feedback list from this morning probably has the same items as right now. The delta between cached truth and current truth is usually insignificant compared to the cost of waiting.

The pattern inverts the traditional model. Instead of "wait for truth, then display," it becomes "display what you know, seek truth in parallel." The user sees something immediately. The system catches up invisibly.

This same principle appears in eventual consistency models for distributed databases—Dynamo, Cassandra, and their descendants. Werner Vogels at Amazon articulated it as accepting that perfect consistency has a latency cost, and most applications can tolerate brief windows of staleness in exchange for availability.

The deeper lesson: optimizing for *perceived* performance often matters more than optimizing for *actual* performance. A 200ms response that blocks feels slower than instant display plus a 500ms background sync. Human perception is not a stopwatch.
