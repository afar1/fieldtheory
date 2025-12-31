# CSS Visibility Over Conditional Rendering for Stateful Views

**Evolution**: v2 (Dec 2025) - refined to "lazy mount then keep mounted"

## Evolution History

- **v1 (Dec 2025)**: First attempt - mount immediately, hide with CSS. Caused broken images.
- **v2 (Dec 2025)**: Refined to "lazy mount then keep mounted" pattern.

---

## The Story

User reported a "slight but perceptible loading" when reopening the Shared Context tab. Investigation revealed:

1. The Electron window was already being hidden/shown (not destroyed/recreated) - that wasn't the issue
2. The React component (`SharedContextView`) was conditionally rendered via ternary operators
3. Every tab switch caused the component to unmount and remount
4. On remount: auth check, data refetch, "Loading..." flash, "Team (0)" → "Team (3)" flash

The problematic pattern:

```tsx
{viewMode === 'team' ? (
  <SharedContextView />
) : viewMode === 'dms' ? (
  <DMsView />
) : (
  <ClipboardList />
)}
```

Every time `viewMode` changes away from `'team'` and back, `SharedContextView`:
- Unmounts (loses all state)
- Remounts (re-runs all useEffects)
- Re-checks auth (async - shows "Loading...")
- Re-fetches team members (shows "Team (0)" → "Team (3)")

## First Attempt (v1) - Mount Immediately

Keep expensive components always mounted, use CSS to hide:

```tsx
{/* Always mounted, hidden via CSS when not active */}
<div style={{ 
  display: viewMode === 'team' && !showSettings ? 'flex' : 'none',
  ...
}}>
  <SharedContextView />
</div>
```

**Problem**: This caused broken images! When `SharedContextView` mounted immediately (before auth was ready), image fetches failed. The component rendered with broken image icons because the Supabase storage URLs require authentication.

## The Real Fix (v2) - Lazy Mount Then Keep Mounted

```tsx
// Track if user has ever visited the team tab
const [hasShownTeamView, setHasShownTeamView] = useState(() => {
  const saved = localStorage.getItem('fieldTheoryView');
  return saved === 'team';
});

// Mark as shown when user first visits
if (viewMode === 'team' && !hasShownTeamView) {
  setHasShownTeamView(true);
}

// Only mount AFTER first visit, then keep mounted
{hasShownTeamView && (
  <div style={{ 
    display: viewMode === 'team' && !showSettings ? 'flex' : 'none',
    ...
  }}>
    <SharedContextView />
  </div>
)}
```

Result: 
- First visit: Component mounts when user clicks the tab (auth is ready)
- After that: Component stays mounted, just hidden via CSS
- Tab switches are instant, no broken images, no loading flashes

## When to Apply This Pattern

Use CSS visibility for components that:

1. **Have expensive initialization** - auth checks, data fetching, websocket subscriptions
2. **Are frequently shown/hidden** - tabs, panels, dialogs
3. **Benefit from instant perceived performance** - especially in Electron apps competing with native feel

Keep conditional rendering for components that:

1. **Are truly ephemeral** - modals, tooltips, one-time flows
2. **Need cleanup on unmount** - form resets, canceled uploads
3. **Have no expensive initialization** - stateless display components

## The Tradeoff

**Memory**: Hidden components stay in memory. For most apps, this is negligible (a few MB). For this clipboard app with one or two extra views mounted, it's invisible.

**Timing dependencies**: If a component requires auth/session to be ready before it can load resources (images, data), mounting it too early causes failures. The "lazy mount" approach solves this by deferring mount until the user actually visits.

**Initial mount cost**: All CSS-hidden components mount on first render. If you have 10 heavy tabs, this might slow initial load. Solution: lazy-mount on first visit, then keep mounted.

## Connection to Electron Apps

Electron apps that feel "native" do this well:

- **Alfred/Raycast**: Window is hidden, not destroyed. Content stays ready.
- **Spotlight**: Instant appearance because nothing is being re-initialized.

The lesson: perceived performance often matters more than actual performance. A 200ms auth check is technically fast, but the flash of "Loading..." makes the app feel sluggish.

## The Debugging Journey

What made this non-obvious:

1. **Electron layer looked correct** - window was already hidden/shown, not destroyed/recreated
2. **The flash was subtle** - easy to dismiss as "normal loading"
3. **Caching was partial** - `teamItems` was cached in localStorage, but `teamMembers` wasn't, causing the "0 → N" flash
4. **Root cause was architecture** - conditional rendering is so common that it's easy to miss as the source of mount/unmount churn

## The Meta-Lesson

When debugging perceived performance:

1. **Trace the full stack** - browser → Electron → React → component lifecycle
2. **Check mount behavior** - Is the component staying mounted or remounting?
3. **Look for "0 → N" patterns** - State that resets suggests remounting
4. **Consider caching at multiple levels** - localStorage, component state, CSS visibility

For tab-based UIs with stateful views, the answer is often: keep them mounted, hide with CSS.
