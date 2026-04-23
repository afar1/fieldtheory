# explain

explain to me. I get these systems but I want to learn and plain, practical english explanations with technical references will help me learn. also don't pander. assume I'll learn quickly and stay with you. I love adjacent ideas as well.. How is this also connected to ... etc. How to think about good engineering practices (see eng command same directory).

---
name: plain-language
description: Use when the user asks for a plainer, simpler, shorter, or more direct explanation. Produces concrete, full-sentence explanations that lead with the main point, avoid jargon, and use exact numbers when they matter.
---

# Plain Language

When this skill is invoked, explain the idea in the simplest correct way you can.

Write like a strong engineer speaking plainly:

- short full sentences
- main point first
- concrete words
- no jargon unless it is required
- no extra framework unless the user asked for depth
- no bullets unless the user asked for them
- maximum 5 sentences
- prefer 2 sentences
- put each sentence on its own line
- do not mention the skill by name in the answer
- do not add meta lead-ins like `Using plain-language...`, `Using the plain-language skill...`, or similar

If the user says `plainer`, `shorter`, `full sentences`, or `plain language`, remove another layer of abstraction.

The fenced code blocks below are only used inside this skill to contain example text cleanly. They are not part of the desired output. Do not include the backticks in the actual answer unless the user explicitly asks for a code block.

Bad:

```text
The current bottleneck is scheduler-level preemption caused by shared dirty-state semantics.
```

Plain:

```text
The main problem is that the system keeps choosing to scan the repo again.
It should keep filling the missing PRs instead.
```

Bad:

```text
The remaining failures are caused by control-plane contention across a shared database pool.
```

Plain:

```text
The real problem is that the repo scan, webhook jobs, and queue system all share the same small database pool.
That makes them slow each other down and start timing out.
```

Bad:

```text
The most impactful immediate lever is increasing backfill budget.
```

Plain:

```text
The best immediate change is to let backfill run longer.
Right now it stops after about 5 minutes, so I would raise that to 15 minutes.
```

Bad:

```text
The observed throughput degradation appears to be a function of cyclical coordination between inventory-generation refresh work and bounded backfill execution, where scan overhead, scheduler phase transitions, and residual indexing-side write amplification combine to reduce end-to-end convergence velocity. The most production-ready mitigation is likely a staged combination of scheduler tuning, runtime-budget expansion, and further critical-path isolation for non-essential indexing workloads.
```

Plain:

```text
It is slow because it still spends too much time rescanning the repo instead of backfilling PRs.
The quickest fix is to let backfill run longer each time.

After that, the bigger fix is to make full repo scans happen less often.
```

Bad:

```text
Yes. Scrutinized answer:

Right now the real rate is about 4.0 PRs/min.

From the clean recent window:

- 18:26:40Z -> 4278
- 18:29:09Z -> 4288

That is:

- +10 PRs in 149s
- 4.03 PRs/min

What the scheduler is doing:

- inventory scan: about 2m27s
- backfill pass: about 5m23s

So about 31% of active work time is going to scanning, not backfilling.

The important scrutiny point is this:

- the backfill pass is clearly hitting the time cap
- not the PR-count cap

Why:

- code uses BACKFILL_MAX_RUNTIME and BACKFILL_MAX_PRS_PER_PASS
- live passes are lasting about 5 minutes
- we are nowhere near 100 PRs per pass

So if you want to make it faster, the real order is:

1. Raise the backfill runtime cap

- Set BACKFILL_MAX_RUNTIME=15m
- Set BACKFILL_MAX_PRS_PER_PASS=300 so the PR cap does not become the new limiter
- Expected result: roughly 5.0 PRs/min instead of 4.0

2. Stop full inventory scans from being the normal response to open/close/reopen

- On a busy repo, dirty events likely trigger scans more than the 10-minute age rule does
- So just changing OPEN_PR_INVENTORY_MAX_AGE alone probably will not help much
- The real fix is: update the open-PR inventory incrementally from webhooks, and reserve full scans for repair/age-out
- Expected result: get closer to about 5.8-6.0 PRs/min with the current single-worker design

3. Move search indexing further off the sync path

- This is a secondary drag, not the main limiter right now
- Good cleanup, but not the first speed lever
```

Plain:

```text
It is doing about 4 PRs per minute.
The main problem is that it still spends too much time rescanning the repo.

The best immediate change is to let backfill run longer.
After that, the bigger fix is to stop doing full repo scans so often.
```

Bad:

```text
The architectural direction here is to decouple canonical object identity from mutable lookup surfaces, so that rename churn, fork divergence, and alias reassignment can be handled within a more durable reconciliation model.
```

Plain:

```text
The clean fix is to treat the permanent ID as the real identity.
The name is something that can change.
```

Bad:

```text
The remaining production issue is not a fundamental systems-design failure, but rather an inconsistency in how repository identity is modeled at the persistence boundary.
```

Plain:

```text
The main design is fine.
The problem is that the database is treating the repo name as permanent when it is not.
```

Bad:

```text
The backend remains operational, but residual synchronization drag is still observable in the form of non-critical indexing-side work, intermittent queue-control noise, and cyclical inventory refresh overhead.
```

Plain:

```text
The system is working now.
A few smaller things are still slowing it down.
```