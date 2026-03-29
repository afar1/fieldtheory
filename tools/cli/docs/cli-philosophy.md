# ft CLI Philosophy

## Core idea

`ft` should be a **Field Theory CLI-native intelligence and orchestration layer**.

It should be easy for:
- a human in the terminal,
- OpenClaw,
- Clawd,
- Ursa,
- or other agentic interfaces

to invoke `ft` to inspect datasets, retrieve relevant context, run recurring jobs, and surface worthwhile proposals or artifacts.

The user should be able to stay in their normal interface while `ft` does the structured work behind the scenes.

---

## What ft should own

`ft` should own:
- the CLI surface
- dataset/job configuration
- recurring dataset review logic
- bookmark corpus ingestion and local indexing
- cached summaries/artifacts/proposals
- promptable/reusable orchestration patterns
- integration points to OpenClaw cron and chat/email surfaces

This is the control plane.

---

## What ft should not own by default

`ft` should **not** have to become the system of record for every external dataset.

In general, external systems should remain their own source of truth:
- repos stay repos
- files stay files
- databases stay databases
- remote APIs stay remote APIs
- note systems stay where they are

`ft` should point at them, inspect them, and cache only what it needs.

---

## Storage philosophy

### Store locally when there is strong product value
Local storage is justified when it materially improves product behavior.

Examples:
- bookmark corpus and bookmark backfill data
- bookmark-derived metadata and indices
- proposals, artifacts, and discussion outputs
- compact state for recurring dataset jobs
- lightweight cached summaries for faster repeated reasoning

### Avoid absorbing entire external systems by default
Do not import everything unless there is a real reason.

Examples where local ownership is usually unnecessary:
- full code repos
- entire external databases
- full note systems
- large remote data stores that can be queried directly

---

## Pointer-first model

The default pattern should be:
1. point at a source
2. inspect / retrieve relevant context
3. reason over it
4. cache lightly if useful
5. create proposals/artifacts only when warranted

This keeps `ft`:
- extensible
- lightweight
- composable
- less likely to become a giant data hoarder

---

## Bookmarks are a special case

Bookmarks justify local storage because:
- the X API may expose only a partial recent subset
- historical recovery may require browser-backed backfill
- users want corpus-level search/theme analysis over time
- bookmark relevance often resurfaces later

So bookmarks should be treated as a first-class local corpus inside `ft`.

---

## Dual use: scheduled and real-time

`ft` should support both:

### 1. Scheduled use
Recurring jobs over datasets.
Examples:
- daily bookmark sync
- morning analysis pass
- repo review
- notes review

### 2. Real-time invocation
One-shot CLI use from terminal or agent interfaces.
Examples:
- `use the ft theory CLI to compare this bookmark idea to our current project`
- `review this repo for relevant opportunities`
- `search the bookmark corpus for medical ideas related to Alzheimer’s`

This is critical. `ft` should not just be a scheduler; it should be an invocation surface.

---

## Agent-invocable design

Because agents/interfaces will invoke `ft`, the CLI should be:
- predictable
- non-interactive by default
- rich in examples/help
- capable of machine-readable output
- conservative with noisy output
- stable in its command shapes

This is both good CLI design and good agent design.

---

## Relevance philosophy

Not everything should be ranked only by current project utility.

`ft` should be able to distinguish between:
- relevant to active work now
- relevant to long-horizon personal importance later
- interesting but unprioritized
- likely distraction

This matters especially for bookmarks around:
- medical research
- cancer / Alzheimer’s
- food / fitness
- industry knowledge
- other life domains that matter even when not immediately actionable

---

## Proposed command families

### Dataset and source configuration
- `ft dataset ...`
- `ft source ...`

### Job management
- `ft job ...`

### Bookmark corpus work
- `ft bookmarks ...`

### Real-time review/research/proposal flows (future)
- `field review ...`
- `field research ...`
- `field propose ...`
- `field related-to ...`

These should be designed so OpenClaw or another agent can say:
- “use the ft CLI to do XYZ”

---

## Integration with OpenClaw / Clawd / Ursa

The ideal experience is:
- the user stays in their normal surface
- that surface invokes `ft`
- `ft` handles structured retrieval/orchestration
- results return as a concise proposal, artifact, or report

That means:
- OpenClaw can use `ft` for dataset jobs and one-shot analysis
- Clawd/Ursa can remain the user-facing shell
- `ft` becomes the durable backend capability layer

---

## Practical design rule

`ft` should be:
- CLI first
- pointer first
- local-storage selective
- agent invocable
- cron compatible
- artifact oriented

This keeps it useful without forcing it to become a universal database or monolithic app.

---

## Summary

`ft` is best thought of as:

> a CLI-native intelligence and orchestration layer that points at important data sources, stores locally only where it adds real value, and can be invoked both on a schedule and in real time from the user’s preferred interface.

## Backfill product note

When exploratory or one-off bookmark backfills prove useful (for example richer media metadata, author images, or moving-media recovery), those improvements should be folded back into the primary `ft` bookmark tool rather than left as ad hoc local scripts. Prioritize getting the archival data first, then promote durable pieces into the shared tool.

## Rich metadata backfill blocker

The GraphQL bookmark parser/schema now preserves richer fields (author profile image URL, author snapshot, postedAt, engagement, mediaObjects, rawTweet/rawUser). The remaining blocker is not schema or parsing; it is obtaining reusable authenticated GraphQL access without depending on launching Chrome against a live profile. Next step: supply known-good `ct0` + session cookie header (or equivalent direct auth material) into `graphql-bookmarks.ts` via the new injected-auth path, then rerun a small enriched sync and fetch author images.
