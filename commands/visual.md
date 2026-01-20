# Visual Analysis

Generate an ASCII diagram to analyze the system, component, or process under discussion.

## When to use

- Debugging event handling (hover, click, focus) where behavior is unexpected
- Understanding container/component hierarchy and nesting
- Tracing state flow through a system
- Identifying gaps in handler coverage or "dead zones"
- Decomposing complex UI layouts

## Output format

Produce a tree-style ASCII diagram showing:

```
Container/System Name
│
├─ [A] Element Name ────────────────────────────────────────────────────
│      property: value
│      ✓ has handler (describe what it does)
│      ✗ missing handler ← PROBLEM (if relevant)
│      │
│      └─ [A.1] Child Element
│             property: value
│             (covered by parent) or (has own handler)
│
├─ [B] Sibling Element ─────────────────────────────────────────────────
│      property: value
│      ✗ NO handler ← marks gaps in coverage
│
└─ [C] Another Element
       property: value
```

## Annotations

- `✓` = has the relevant handler/behavior
- `✗` = missing handler/behavior (potential bug source)
- `← PROBLEM` = likely cause of the issue
- `← TAKES MOST OF THE WIDTH` = notes about layout impact
- `(covered by parent)` = inherits behavior from ancestor

## Analysis section

After the diagram, provide:

1. **The Bug**: One sentence explaining what the diagram reveals
2. **The Fix**: Specific code change needed
3. **The Lesson**: Reusable principle for future debugging

## Example invocation

"Draw a visual diagram of the hover containers in the header area"
"Use visual analysis on the state management flow"
"Visual breakdown of the event bubbling in this component"
