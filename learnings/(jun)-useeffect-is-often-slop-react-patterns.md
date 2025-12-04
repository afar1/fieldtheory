# useEffect is Often Slop - React Patterns

**Evolution**: v1 (June 2025)

## The Debugging Story

We debugged a clipboard history dialog that was "blinking into existence then dismissing" - the dialog would appear briefly, then disappear while the transparent overlay remained visible.

Root cause: A `useEffect` hook in `ClipboardHistory.tsx` had `isVisible` in its dependency array, but the effect itself was *setting* `isVisible` to `true`. This created a re-initialization loop:

```typescript
useEffect(() => {
  setIsVisible(true);  // Sets isVisible
  // ... other setup
}, [isVisible, loadItems]);  // Depends on isVisible - creates loop!
```

Every time `isVisible` changed, the effect re-ran, resetting state, causing the dialog to disappear and reappear.

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
   - Extra deps → infinite loops (exactly what we hit)
   - Self-referential deps → re-initialization cycles
3. **Timing unpredictability** - Runs after render, causing flash-of-incorrect-content issues
4. **Often a code smell** - Many usages are trying to do something that should happen elsewhere

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

When you do use `useEffect`, be extremely careful with dependency arrays. If a dependency is also set by the effect, that's a red flag.





