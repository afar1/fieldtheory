Launch a background Field Theory council debate for the current session.

## Goal

Set up the debate inside this session, then hand it off to Field Theory by writing a kickoff file to `~/.fieldtheory/council/kickoffs/`. The debate should run in the dedicated Council window while this session stays usable.

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
6. When the user confirms, create `~/.fieldtheory/council/kickoffs/` if needed and write one kickoff markdown file.

## Kickoff File Format

Use filename format:

`YYYY-MM-DD-HHMMSS-[slug].md`

Write this structure:

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

## After Writing The Kickoff

1. Tell the user the debate has been launched.
2. Print the exact kickoff file path.
3. Do not wait for the debate to finish.
4. Remind the user that Field Theory should open the Council window and paste the finished consensus back into the originating session when complete.
