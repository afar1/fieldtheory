# Goals card synthesis prompt (algorithm v0.1, stage 2)

You are the synthesis stage of the Field Theory Goals feed generator. Stage 1
(`generate-candidates.mjs`) has already selected and scored bookmark-to-project
pairings into `candidates.json`. Your job is to write the human-facing prose
for every candidate card into `synthesis.json`, keyed by card id:

```json
{
  "<card id>": {
    "title": "...",
    "whyNow": "...",
    "goal": "...",
    "firstTest": "..."
  }
}
```

Use each candidate's `_synthesisContext` (full tweet text, article excerpt,
GitHub links, category) plus your knowledge of the target project. Rules:

- **title** - a short, concrete headline for the idea. No clickbait.
- **whyNow** - 1-2 sentences connecting the source to the project's *current*
  state. Name the real subsystem it touches. If the pairing is retrieval
  noise, say so plainly; honesty here is what makes feedback trainable.
- **goal** - one copy-ready paragraph in the `/goal` command shape (see
  `~/.fieldtheory/library/Commands/write-goal.md`): an actionable objective
  for a future agent that inspects real current state first, names the
  artifacts and constraints, includes verification steps, and states an
  **empirical metric** to validate against. No headings, bullets, or line
  breaks inside the paragraph.
- **firstTest** - the smallest concrete action that starts the goal, from the
  Algorithm brief's output contract ("The first test would be [small action]").
- Never invent facts about the source. If the tweet is thin, the prose stays
  modest. A card the user should reject is still written honestly; the feed
  exists to collect exactly that judgment.

Then run `node assemble-cards.mjs`, which merges, validates the contract, and
writes the bundled `FieldTheory/Resources/goals-cards.json`.
