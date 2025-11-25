-create a roadmap item, use the framework below to do so of the item that I have called out we're going to do at some point in the future in our discussion.

# Roadmap folder

Purpose: A simple, running list of future work items and context we don’t want to lose.

## Naming convention
- Files are named with the month (or `(Mon)`), then `roadmap-`, then a short narrative slug.
- Examples:
  - `(Oct)-roadmap-live-room-ux-polish.md`
  - `(2025-10)-roadmap-live-room-ux-polish.md`

## When to add an entry
- When we discuss work we are not actively implementing.
- When we identify follow-ups, risks, or performance work.

## Suggested file template
```
# Title (short narrative)

## Summary
- One paragraph describing the intent and scope.

## Why now / why later
- Rationale for deferring or prioritizing.

## Proposed approach (concise)
- Bulleted implementation outline.

## Open questions / risks
- Bulleted list.

## Success criteria
- Measurable outcomes.
```

## Quick command to add items
- Use this phrasing when asking the assistant to add a roadmap entry:

```
/roadmap (Oct) "Live Room UX polish" -- summary: persistence to server per home/user; success: order persists after reload.
```

Rules the assistant will follow:
- Create a file named `(Mon)-roadmap-<slug>.md` (or `(YYYY-MM)-roadmap-<slug>.md`) under this folder, where `<slug>` is a kebab-case version of the quoted title.
- Populate the template with the provided summary and any context from the current thread.

## Marking completion
- When a roadmap item is fully delivered, append ` (done YYYY-MM-DD)` to the first H1 title line and add a short "Outcome" section describing the result.

