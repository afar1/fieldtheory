# The Archaeology of Conflict Resolution

In 1978, Lamport published his paper on clocks in distributed systems. The problem he addressed was deceptively simple: how do you know which event happened first when there's no shared clock?

His solution—logical clocks—became the foundation for everything from database replication to the sync infrastructure we just tested. The `mergeByLastWriteWins` function implements a direct descendant of this idea: when two systems disagree about the state of the world, the one with the higher timestamp wins.

This seems crude. And it is. Amazon's Dynamo paper (2007) called last-write-wins a "very simple conflict resolution" that can lead to "lost updates." They weren't wrong. If you edit a todo on your phone while I edit it on my laptop, one of us loses.

But here's the thing the Dynamo authors also noted: for many applications, losing an update is acceptable if the alternative is complexity that nobody can reason about. CRDTs (Conflict-free Replicated Data Types) emerged in the 2010s as a theoretically beautiful alternative—data structures that mathematically cannot conflict. But they're subtle. A CRDT counter that tracks "number of items" needs different operations for increment vs. set. A text CRDT needs to track the causal history of every character.

Last-write-wins is the Model T of distributed systems: ugly, limited, but you can understand it in five minutes. The test we just wrote—`remote wins on tie (same timestamp)`—documents a design decision that's been made a thousand times across a thousand systems. It's not the "right" answer. It's an answer that ships.

The logging we'll add in Phase 4 isn't admission of defeat. It's the beginning of empirical understanding. How often do conflicts actually occur? What data is lost? The next step isn't always more sophisticated algorithms—sometimes it's better UX that reduces concurrent edits in the first place.

Lamport's paper was titled "Time, Clocks, and the Ordering of Events." Forty-eight years later, we're still arguing about what "first" means.
