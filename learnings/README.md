# Learnings

This directory documents key insights, patterns, and principles discovered through building and debugging this codebase.

## Index

- **[useEffect is Often Slop - React Patterns](./(jun)-useeffect-is-often-slop-react-patterns.md)** (v2) - Why `useEffect` is overused and how to avoid it. Two traps: dependency array loops and batching defeating per-event work. Do the work in event handlers, not downstream effects.

- **[CSS Visibility Over Conditional Rendering](./(dec)-css-visibility-over-conditional-rendering-for-stateful-views.md)** (v2) - For tab-based UIs with expensive-to-initialize views, use "lazy mount then keep mounted" pattern: don't mount until first visit (to avoid auth/timing issues), then keep mounted with CSS visibility (to avoid remount flashes). Immediate mount caused broken images; pure conditional rendering caused loading flashes. The hybrid approach gets both right.







