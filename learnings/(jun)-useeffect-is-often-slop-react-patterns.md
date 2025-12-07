# useEffect is Often Slop - React Patterns

**Evolution**: v2 (Dec 2025) - added scroll lag example

## Evolution History

- **v1 (June 2025)**: Discovered dependency array trap causing dialog blink loop
- **v2 (Dec 2025)**: Discovered timing/batching trap causing scroll lag during rapid keyboard navigation

---

## Story 1: The Dialog Blink Loop (June 2025)

We debugged a clipboard history dialog that was "blinking into existence then dismissing" - the dialog would appear briefly, then disappear while the transparent overlay remained visible.

Root cause: A `useEffect` hook in `ClipboardHistory.tsx` had `isVisible` in its dependency array, but the effect itself was *setting* `isVisible` to `true`. This created a re-initialization loop:

```typescript
useEffect(() => {
  setIsVisible(true);  // Sets isVisible
  // ... other setup
}, [isVisible, loadItems]);  // Depends on isVisible - creates loop!
```

Every time `isVisible` changed, the effect re-ran, resetting state, causing the dialog to disappear and reappear.

---

## Story 2: The Scroll Lag Problem (Dec 2025)

Pressing the down arrow key multiple times quickly caused the scrollbar to lag behind - you'd press down 10 times and then watch the scrollbar catch up.

The problematic code:

```typescript
// In key handler:
if (key === 'ArrowDown') {
  setSelectedIndex(prev => Math.min(prev + 1, listRows.length - 1));
  return;
}

// Separate effect to handle scrolling:
useEffect(() => {
  if (listRef.current && selectedIndex >= 0) {
    const element = listRef.current.children[selectedIndex] as HTMLElement;
    element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}, [selectedIndex]);
```

**Why this fails:**

1. **React batches state updates** - pressing down 10 times quickly doesn't run the effect 10 times. React batches the `setSelectedIndex` calls and the effect runs once at the end.

2. **`behavior: 'smooth'` can't keep up** - even if effects did run per keypress, smooth scrolling animations overlap and lag behind.

3. **Effects run after render** - there's an inherent delay between state change and effect execution.

**The fix:** Do the work directly in the event handler where you have immediate access to the new value:

```typescript
if (key === 'ArrowDown') {
  const newIndex = Math.min(selectedIndex + 1, listRows.length - 1);
  setSelectedIndex(newIndex);
  // Scroll immediately - DOM elements already exist
  const element = listRef.current?.children[newIndex] as HTMLElement;
  element?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  return;
}
```

Key insight: **The DOM elements already exist in the list.** We don't need to wait for React to render - we can scroll to them immediately.

## The Core Insight

**`useEffect` is often "slop" in disguise** - especially in AI-generated code.

### Why AI Overuses useEffect

1. **Reflexive pattern matching** - AI sees "side effect" and immediately reaches for `useEffect` because it's the "React way"
2. **Safe default** - It feels "safe" and "React-y" even when inappropriate
3. **Lack of context** - AI doesn't understand the broader flow, so it uses effects to bridge gaps

### The Problems with useEffect

1. **Hidden complexity** - Creates implicit relationships between state and side effects that are hard to trace
2. **Dependency array footguns**:
   - Missing deps → stale closures
   - Extra deps → infinite loops (Story 1)
   - Self-referential deps → re-initialization cycles
3. **Timing unpredictability** - Runs after render, causing flash-of-incorrect-content issues
4. **Batching defeats per-event work** - React batches state updates, so effects don't run per event (Story 2)
5. **Often a code smell** - Many usages are trying to do something that should happen elsewhere

## When useEffect Is Actually Legitimate

`useEffect` is appropriate for:

- **Syncing with external systems** (DOM APIs, subscriptions, websockets, timers)
- **Event listeners** that need cleanup
- **IPC subscriptions** (like our clipboard API listeners)

The key: it's for *external* systems, not internal React state coordination.

## Better Alternatives

| Instead of... | Use... |
|--------------|--------|
| `useEffect` to transform data | Derive it during render |
| `useEffect` to respond to prop changes | Handle in event handlers |
| `useEffect` to sync two state values | Combine into one state or derive |
| `useEffect` for data fetching | React Query, SWR, or server components |
| `useEffect` to set state based on other state | Derive during render or handle in event handler |
| `useEffect` for side effects on state change | Do the work directly in the event handler |

## Connection to "Deslop" Philosophy

This ties directly to the `/deslop` command philosophy:

- **AI-generated code slop** often includes unnecessary `useEffect` hooks
- **Over-defensive patterns** - wrapping everything in effects "just in case"
- **Inconsistent style** - effects where event handlers would be clearer

The fix for our clipboard bug? Remove `isVisible` from the dependency array - the effect should only run once on mount, not every time visibility changes. The effect is legitimate (IPC subscriptions), but the dependency was wrong.

## The Rule

**Avoid `useEffect` unless absolutely necessary.** 

Default to:
1. Derive values during render
2. Handle changes in event handlers
3. Use effects only for external system sync

When you do use `useEffect`, be extremely careful with:
- **Dependency arrays** - If a dependency is also set by the effect, that's a red flag
- **Timing assumptions** - Effects run after render, and React batches state updates
- **Per-event work** - If you need something to happen for every user action, do it in the handler, not an effect

## The Meta-Pattern

Both bugs share a common antipattern: **using useEffect as a "reaction" to state changes when the work should happen at the source.**

- Story 1: Effect "reacts" to visibility changes it caused itself → loop
- Story 2: Effect "reacts" to selection changes, but batching defeats per-keypress scroll

The fix in both cases: do the work where the change originates (the event handler), not downstream in an effect.







