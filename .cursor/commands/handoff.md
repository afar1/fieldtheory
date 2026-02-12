Session Handoff

Create a compact handoff document for continuing this conversation in a new session.

## Output Format

Write a markdown file to `~/Library/Application Support/fieldtheory-mac/handoffs/[project]-[timestamp]-handoff.md` with:

```markdown
# Session Handoff - [Project Name]

## Current State
[2-3 sentences: what we're working on, where we left off]

## Recent Changes
[Bullet list of files modified/created this session]

## Key Decisions Made
[Bullet list of important decisions/choices made]

## Next Steps
[Numbered list of what to do next, in order]

## Context Files
[List the most important files to read to understand the current work]

## Commands to Run
[Any pending commands or builds that need to happen]
```

## Instructions

1. Create `~/Library/Application Support/fieldtheory-mac/handoffs/` directory if it doesn't exist
2. Use filename format: `[parent]-[project]-[YYYY-MM-DD-HHMMSS]-handoff.md`
   - Include BOTH the parent directory AND current directory for context
   - Example: working in `/Users/afar/dev/fieldtheory/mac-app` → `fieldtheory-mac-app-2025-02-11-143022-handoff.md`
   - Example: working in `/Users/afar/projects/acme-website` → `projects-acme-website-2025-02-11-143022-handoff.md`
3. Be concise - this is for context efficiency
4. Focus on actionable state, not history
5. After writing, output the file path so user can reference it

When resuming from handoff. Give me a comprehensive summary about the key points about the handoff doc. Feel free to ask any questions you have that may not have been obvious from the handoff doc.
