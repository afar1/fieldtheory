# Goals feed card generation - algorithm v0.1

The iOS Goals tab shows idea/goal cards generated offline from the live
Field Theory bookmark DB (`~/.fieldtheory/bookmarks/bookmarks.db`) paired
against three hardcoded projects: `fieldtheory-labs`, `fieldtheory`,
`fieldtheory-cli`. Cards ship bundled as
`FieldTheory/Resources/goals-cards.json`; the app never reads the DB itself.

## Regenerating the card set

```bash
cd ios-native/scripts/goals

# Stage 1 - select + score candidates from the live DB.
# Needs fieldtheory-cli built (npm run build there); set FT_CLI_DIR if it
# isn't at ~/dev/fieldtheory-cli.
node generate-candidates.mjs            # -> candidates.json

# Stage 2 - an LLM writes title/whyNow/goal/firstTest per card.
# Give a strong model synthesize.md + candidates.json; it writes synthesis.json.
# e.g. in a Claude Code session: "Read synthesize.md and candidates.json in
# ios-native/scripts/goals and write synthesis.json accordingly."

# Stage 3 - merge, validate the contract, write the bundle.
node assemble-cards.mjs                 # -> ../../FieldTheory/Resources/goals-cards.json

# Then regenerate the Xcode project so the resource is referenced:
cd ../.. && xcodegen generate
```

## Algorithm v0.1 (legible on purpose)

Search is not reimplemented: stage 1 imports `searchBookmarks` /
`getBookmarkById` from fieldtheory-cli's canonical stack (FTS5, bm25 with
text=5 / article_text=3 column weights, porter tokenizer).

1. **Retrieve** - each project profile has ~6 hardcoded FTS queries; top 40
   hits per query, deduped by best bm25 score.
2. **Filter** - drop junk categories (humor, entertainment, personal-story,
   commerce, finance, health, politics) unless the bookmark carries a GitHub
   link; drop bookmarks whose non-URL text is under 60 chars.
3. **Score** - eight axes from the Algorithm brief, each 0...1, all
   deterministic (`scoreAxes` in generate-candidates.mjs): relevance
   (normalized bm25), actionability (category prior + GitHub/article bonus),
   novelty (category prior + cross-domain bonus), leverage, timing (1-year
   half-life on bookmark age), evidence (engagement + artifacts), confidence
   (metadata completeness), cost (category prior, higher = pricier).
4. **Rank** - `composite = 0.25*rel + 0.20*act + 0.15*nov + 0.10*lev +
   0.10*tim + 0.10*evi + 0.10*conf - 0.15*cost`.
5. **Pick** - globally by composite: one card per tweet (best project wins),
   near-duplicate texts collapsed, max 2 cards per author per project, top 10
   per project.
6. **Synthesize** - a strong model writes the prose (stage 2); scores are
   never model-written in v0.1.

Known, deliberate limits: embeddings are unused (the `commons_embeddings`
table is empty; do not pretend otherwise), `commons_cards` is not consumed
(nothing in fieldtheory-cli reads it yet), and retrieval noise is *expected*:
the feed's not-useful judgments on noisy cards are the training signal that
justifies v0.2.

## The feedback loop

Every judgment in the app lands in the local `goal_feedback` table
(card id, algorithm version, project, action `useful|not_useful|pursued`,
optional context, timestamp). Export it from the Goals tab toolbar. Offline
eval for any v0.2: known-useful cards must rank above known-not-useful cards
from this table.
