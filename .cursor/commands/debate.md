Launch a council debate for the current session.

## Goal

Start a debate between two AI models, then hand it off to run in the background. The debate runs in a dedicated Council process while this session stays usable.

## Workflow

1. Detect which CLIs are available by checking:
   - `command -v claude`
   - `command -v codex`
2. If the user already specified a matchup, turn limit, or extra context, keep it.
3. Otherwise ask only the missing questions:
   - matchup
   - debate length in turns
   - any extra context or constraints
   - accept natural-language variants like "opus v codex" or "codex vs sonnet" and normalize them to the supported values below
4. Recommended defaults:
   - if both `claude` and `codex` are available: `opus-vs-codex`
   - if only `claude` is available: `opus-vs-opus`
   - if only `codex` is available: `codex-vs-codex`
   - default max turns: `6`
5. Summarize the current session topic before kickoff:
   - write a 3-6 sentence summary of the actual work in progress
   - include concrete files, goals, constraints, and unresolved questions when possible
   - show that summary to the user and ask whether they want to add or correct anything

## Launching the debate

Use the `mcp__council__council_start` MCP tool with these parameters:
- `topic`: the full session summary + extra context + desired output format
- `opus_vs_opus`: true if matchup is opus-vs-opus, false otherwise (Claude vs Codex)
- `max_turns`: the agreed turn limit
- `repo_path`: the absolute path to the current working directory (if relevant)

If the MCP tool is not available, fall back to shell:
```bash
~/dev/council/council-bg.sh --max-turns <N> --repo <path> "<topic>"
```

## Kickoff file (audit artifact)

Also write a kickoff markdown file to `~/.fieldtheory/council/kickoffs/` with filename format `YYYY-MM-DD-HHMMSS-[slug].md` for the record. This is an audit trail, not the launch mechanism.

```md
---
matchup: [selected matchup]
max-turns: [selected max turns]
repo-path: [absolute current working directory, if relevant]
---
# [short debate title]

## Session Summary
[your summary of the current session]

## Extra Context
[user-added context, or "None."]

## Desired Output
Return a direct consensus for the original session, including:
- key decisions
- rationale
- outstanding questions that still need human judgment
- the recommended next step
```

## Matchup Values

Use only these values:

- `opus-vs-opus`
- `opus-vs-sonnet`
- `opus-vs-codex`
- `sonnet-vs-opus`
- `sonnet-vs-codex`
- `codex-vs-opus`
- `codex-vs-codex`
- `codex-vs-sonnet`
- `sonnet-vs-sonnet`

## After Launching

1. Tell the user the debate has been launched.
2. Print the session ID and kickoff file path.
3. Do not wait for the debate to finish — it runs in the background.
4. The user can check status with `mcp__council__council_status` or `~/dev/council/council-bg.sh --status`.

 ## Persist Debate Into The Field Theory Wiki

  After the debate finishes, persist it into the live Field Theory wiki at:

  - `WIKI_ROOT="${FT_DATA_DIR:-$HOME/.ft-bookmarks}/md"`
  - `DEBATES_DIR="$WIKI_ROOT/debates"`

put it in the Debates directory that already exists.

  ### What to save

  Treat the **council consensus** as the primary artifact.

  Do **not** save a short editorialized summary page in `debates/`.
  The visible debate page must be the actual readable consensus document.

  For each completed debate, write exactly two markdown files:

  1. Visible consensus page:
     - `debates/<debate-slug>.md`

  2. Hidden raw transcript sidecar:
     - `debates/_<debate-slug>-transcript.md`

  The underscore-prefixed transcript file is a sidecar artifact and should not be treated as a
  first-class visible wiki page.

  ### Naming

  Derive `<debate-slug>` from the debate date plus a short topic slug.

  Examples:
  - `2026-04-15-wiki-entries-karpathy-refinement`
  - `2026-04-14-sensors-cli-follow-up-debate`

  If a debate page already exists for the same debate, **update it in place** instead of creating a
  duplicate.

  ### Consensus page requirements

  The consensus page is the page the user reads first.

  It must:
  - use the actual debate topic as the `#` title
  - preserve the real consensus content
  - avoid collapsing the consensus into a tiny note
  - strip only low-signal council wrapper text when helpful
  - keep the substantive recommendation sections intact
  - show some of the key areas of debate and any clever or intriguing points
  - end with a bottom link:
    - `[View raw debate transcript](wiki://debates/_<debate-slug>-transcript)`

  Recommended frontmatter:

  ```yaml
  ---
  tags: [ft/entry, ft/debate, ft/decision]
  source_type: authored
  last_updated: YYYY-MM-DD
  ---

  ### Transcript page requirements

  The transcript page must contain the full turn-by-turn debate.

  It must:

  - use the debate topic plus — raw transcript as the # title
  - preserve the full discussion
  - include a link back to the consensus page near the top:
      - [Back to debate consensus](wiki://debates/<debate-slug>)

  Recommended frontmatter:

  ---
  tags: [ft/entry, ft/debate, ft/transcript]
  source_type: transcript
  last_updated: YYYY-MM-DD
  ---

  ### Content transformation rules

  For the consensus page:

  - source it from the generated *.consensus.md
  - keep the real consensus sections
  - remove generic wrappers like # Council Consensus Summary if present
  - remove duplicate **Topic**: lines if the title already covers that
  - do not rewrite the consensus into a short synopsis

  For the transcript page:

  - source it from the raw debate transcript .md
  - preserve the full debate turns
  - remove only generic wrapper headings like # Council Debate if needed
  - do not summarize or compress the transcript

  ### Output shape

  Visible file:

  - debates/<debate-slug>.md
  - primary readable consensus doc

  Hidden sidecar:

  - debates/_<debate-slug>-transcript.md
  - full raw transcript

  ### Important

  The desired wiki UX is:

  - debates/
  - open consensus doc
  - read the real consensus
  - click View raw debate transcript
  - open the full transcript sidecar

  Do not create a second visible debate summary page.
  Do not save the transcript as another first-class debate page.
  Do not leave the debate only in ~/council-transcripts.

  ### Completion

  After writing both files, report:

  - consensus path
  - transcript path
  - debate title
