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
