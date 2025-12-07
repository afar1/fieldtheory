# Learnings

This directory documents key insights, patterns, and principles discovered through building and debugging this codebase.

## Index

- **[useEffect is Often Slop - React Patterns](./(jun)-useeffect-is-often-slop-react-patterns.md)** (v2) - Why `useEffect` is overused and how to avoid it. Two traps: dependency array loops and batching defeating per-event work. Do the work in event handlers, not downstream effects.







