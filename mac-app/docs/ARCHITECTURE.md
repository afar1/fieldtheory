# Mac App Architecture

> A senior developer's guide to understanding Field's Mac application.

---

## High-Level Overview

Field's Mac app is an **Electron application** with three main layers:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              RENDERER PROCESS                                │
│                         (React + TypeScript in src/)                        │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ ClipboardHistory│  │ SharedContext   │  │ SettingsPanel   │             │
│  │     .tsx        │  │    View.tsx     │  │     .tsx        │             │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │
│           │                    │                    │                       │
│           └────────────────────┼────────────────────┘                       │
│                                │                                            │
│                        window.xxxAPI (IPC)                                  │
└────────────────────────────────┼────────────────────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │       preload.ts        │
                    │   (contextBridge APIs)  │
                    └────────────┬────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────────┐
│                              MAIN PROCESS                                    │
│                      (Node.js + TypeScript in electron/main/)               │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                           index.ts                                    │  │
│  │                    (IPC handlers + app lifecycle)                     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│  │ Clipboard   │ │ Transcriber │ │ Vision      │ │ SharedClipboardSync │  │
│  │ Manager     │ │ Manager     │ │ Processor   │ │ (Supabase Realtime) │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘  │
│                                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│  │ MobileSync  │ │ SocialSync  │ │ Audio       │ │ Preferences         │  │
│  │ (iOS sync)  │ │ (DMs, HotMic│ │ Manager     │ │ Manager             │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │     Swift Native        │
                    │   (LittleOneHelper)     │
                    │  CoreAudio, Recording   │
                    └─────────────────────────┘
```

---

## Core Architectural Patterns

### 1. IPC Communication

All renderer ↔ main process communication goes through typed IPC channels:

```typescript
// Define channels in types/clipboard.ts
export const ClipboardIPCChannels = {
  QUERY_ITEMS: 'clipboard:queryItems',
  TEAM_ITEM_ADDED: 'teamClipboard:itemAdded',  // Events pushed to renderer
  // ...
};

// Expose in preload.ts
const clipboardAPI = {
  queryItems: (options) => ipcRenderer.invoke(ClipboardIPCChannels.QUERY_ITEMS, options),
  onTeamItemAdded: (callback) => {
    ipcRenderer.on(ClipboardIPCChannels.TEAM_ITEM_ADDED, handler);
    return () => ipcRenderer.removeListener(...);
  },
};

// Consume in React component
const items = await window.clipboardAPI.queryItems({ limit: 50 });
window.sharedClipboardAPI.onTeamItemAdded((item) => { /* update state */ });
```

**Key principle:** Type definitions live in `types/`, preload exposes the bridge, components consume via `window.xxxAPI`.

---

### 2. Supabase Realtime (Critical Pattern)

For collaborative features (SharedContextView, DMs), we use **Supabase Realtime** instead of polling:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         DATA FLOW: SHARED CLIPBOARD                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌─────────────┐         ┌─────────────┐         ┌─────────────────┐   │
│   │   Teammate  │         │  Supabase   │         │   Your App      │   │
│   │   (Remote)  │         │   Server    │         │   (Local)       │   │
│   └──────┬──────┘         └──────┬──────┘         └────────┬────────┘   │
│          │                       │                         │            │
│          │ INSERT item           │                         │            │
│          │──────────────────────>│                         │            │
│          │                       │                         │            │
│          │                       │ postgres_changes        │            │
│          │                       │ (WebSocket push)        │            │
│          │                       │────────────────────────>│            │
│          │                       │                         │            │
│          │                       │                 ┌───────▼───────┐    │
│          │                       │                 │ setTeamItems  │    │
│          │                       │                 │ (React state) │    │
│          │                       │                 └───────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Implementation in sharedClipboardSync.ts:**

```typescript
this.realtimeChannel = this.supabase
  .channel('team-clipboard-realtime')
  .on('postgres_changes', { event: 'INSERT', table: 'team_clipboard_items' }, 
    async (payload) => {
      const item = await this.rowToTeamItemAsync(payload.new);
      this.emit('teamItemAdded', item);  // EventEmitter to main process
    }
  )
  .subscribe();
```

**Event forwarding in index.ts:**

```typescript
sharedClipboardSync.on('teamItemAdded', (item) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(SharedClipboardIPCChannels.TEAM_ITEM_ADDED, item);
  });
});
```

**React component subscribes in useEffect:**

```typescript
useEffect(() => {
  const unsub = window.sharedClipboardAPI.onTeamItemAdded?.((item) => {
    setTeamItems(prev => [item, ...prev]);
  });
  return () => unsub?.();
}, [session]);
```

---

### 3. Caching Strategy

We use a **cache-first with realtime updates** pattern:

```
┌────────────────────────────────────────────────────────────────────┐
│                      CACHING PATTERN                                │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  MOUNT                                                             │
│    │                                                               │
│    ▼                                                               │
│  ┌─────────────────────────────────────────┐                       │
│  │  Read from localStorage cache           │                       │
│  │  (instant display, no network)          │                       │
│  └─────────────────────────────────────────┘                       │
│    │                                                               │
│    ▼                                                               │
│  ┌─────────────────────────────────────────┐                       │
│  │  Cache empty?                           │                       │
│  │  YES → Fetch from server once           │                       │
│  │  NO  → Skip fetch, realtime handles it  │                       │
│  └─────────────────────────────────────────┘                       │
│    │                                                               │
│    ▼                                                               │
│  ┌─────────────────────────────────────────┐                       │
│  │  Subscribe to realtime events           │                       │
│  │  (INSERT/UPDATE/DELETE push updates)    │                       │
│  └─────────────────────────────────────────┘                       │
│    │                                                               │
│    ▼                                                               │
│  ┌─────────────────────────────────────────┐                       │
│  │  On any state change → update cache     │                       │
│  └─────────────────────────────────────────┘                       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**DO NOT:**
- Fetch from server on every view/mount
- Re-fetch after every mutation (realtime handles it)
- Poll for changes (realtime handles it)

**DO:**
- Load from cache immediately for instant display
- Only fetch if cache is empty
- Let realtime subscription push all updates
- Update cache on every state change

---

### 4. Manager Classes (Main Process)

Each "domain" has a dedicated manager class:

| Manager | Responsibility | Supabase? | Realtime? |
|---------|---------------|-----------|-----------|
| `ClipboardManager` | Local clipboard history (SQLite) | No | No |
| `SharedClipboardSync` | Team clipboard collaboration | Yes | **Yes** |
| `MobileSync` | iOS transcript sync | Yes | No (polls) |
| `SocialSync` | DMs, Hot Mic, Contacts | Yes | **Yes** |
| `TranscriberManager` | Whisper transcription | No | No |
| `VisionProcessor` | MLX image captioning | No | No |
| `AudioManager` | Priority mic, device mgmt | No | No |
| `PreferencesManager` | User settings (JSON file) | No | No |

**Pattern for managers with realtime:**

```typescript
export class SharedClipboardSync extends EventEmitter {
  private realtimeChannel: RealtimeChannel | null = null;
  
  setSession(session: Session | null) {
    if (session && !this.isAuthenticated()) {
      this.setupRealtimeSubscription();  // Start listening
    } else if (!session) {
      this.teardownRealtimeSubscription();  // Clean up
    }
  }
  
  destroy() {
    this.teardownRealtimeSubscription();
    this.removeAllListeners();
  }
}
```

---

## Data Flow Diagrams

### Local Clipboard (Personal History)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LOCAL CLIPBOARD FLOW                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐        ┌──────────────┐       ┌──────────────┐   │
│  │ User copies  │        │ Clipboard    │       │ SQLite DB    │   │
│  │ text/image   │───────>│ Manager      │──────>│ (local only) │   │
│  └──────────────┘        └──────────────┘       └──────────────┘   │
│                                │                       │           │
│                                │ emit('itemAdded')     │           │
│                                ▼                       │           │
│                    ┌──────────────────────┐            │           │
│                    │ IPC: ITEM_ADDED      │            │           │
│                    └──────────────────────┘            │           │
│                                │                       │           │
│                                ▼                       │           │
│                    ┌──────────────────────┐            │           │
│                    │ React component      │<───────────┘           │
│                    │ updates state        │   (also query on mount)│
│                    └──────────────────────┘                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Shared Clipboard (Team Collaboration)

```
┌─────────────────────────────────────────────────────────────────────┐
│                   SHARED CLIPBOARD FLOW                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐        ┌──────────────┐       ┌──────────────┐   │
│  │ Share item   │        │ Shared       │       │ Supabase     │   │
│  │ to team      │───────>│ ClipboardSync│──────>│ (cloud)      │   │
│  └──────────────┘        └──────────────┘       └──────────────┘   │
│                                                        │           │
│                                                        │ realtime  │
│                                                        │ broadcast │
│                                                        ▼           │
│  ┌──────────────┐        ┌──────────────┐       ┌──────────────┐   │
│  │ React state  │<───────│ IPC event    │<──────│ Realtime     │   │
│  │ update       │        │ forwarding   │       │ subscription │   │
│  └──────────────┘        └──────────────┘       └──────────────┘   │
│         │                                                          │
│         ▼                                                          │
│  ┌──────────────┐                                                  │
│  │ localStorage │  (cache for instant display on next mount)      │
│  └──────────────┘                                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
mac-app/
├── electron/
│   ├── main/                    # Main process (Node.js)
│   │   ├── index.ts             # Entry point, IPC handlers, app lifecycle
│   │   ├── clipboardManager.ts  # Local clipboard history (SQLite)
│   │   ├── sharedClipboardSync.ts # Team clipboard (Supabase + Realtime)
│   │   ├── mobileSync.ts        # iOS transcript sync
│   │   ├── socialSync.ts        # DMs, Hot Mic (Supabase + Realtime)
│   │   ├── transcriberManager.ts # Whisper voice transcription
│   │   ├── visionProcessor.ts   # MLX image captioning
│   │   ├── audioManager.ts      # CoreAudio, priority mic
│   │   ├── preferences.ts       # User settings
│   │   ├── promptEngineer.ts    # Claude prompt refinement
│   │   └── types/               # IPC channel definitions
│   │       ├── clipboard.ts
│   │       ├── social.ts
│   │       └── ...
│   ├── preload.ts               # contextBridge API exposure
│   └── native/                  # Swift native helper (CoreAudio, recording)
│
├── src/                         # Renderer process (React)
│   ├── App.tsx                  # Root component
│   ├── components/
│   │   ├── ClipboardHistory.tsx # Main clipboard UI
│   │   ├── SharedContextView.tsx # Team clipboard UI
│   │   ├── SettingsPanel.tsx    # Settings UI
│   │   ├── TodoView.tsx         # Task management
│   │   ├── DMsView.tsx          # Direct messages
│   │   └── ...
│   ├── contexts/
│   │   └── ThemeContext.tsx     # Dark/light theme
│   └── types/
│       └── window.d.ts          # TypeScript types for window.xxxAPI
│
└── docs/                        # Documentation
    ├── ARCHITECTURE.md          # This file
    └── ...
```

---

## Common Pitfalls (Avoid These!)

### 1. Fetching on Every View

**BAD:**
```typescript
useEffect(() => {
  loadItems();  // Fetches from server every time component mounts
}, []);
```

**GOOD:**
```typescript
const [items, setItems] = useState(() => getCachedItems());  // Instant from cache

useEffect(() => {
  if (items.length === 0) {
    loadItems();  // Only fetch if cache is empty
  }
}, []);

useEffect(() => {
  const unsub = window.api.onItemAdded((item) => {
    setItems(prev => [item, ...prev]);  // Realtime handles updates
  });
  return () => unsub?.();
}, []);
```

### 2. Re-fetching After Mutations

**BAD:**
```typescript
const handleDelete = async (id) => {
  await window.api.deleteItem(id);
  await loadAllItems();  // Unnecessary network call
};
```

**GOOD:**
```typescript
const handleDelete = async (id) => {
  await window.api.deleteItem(id);
  // Realtime subscription will push the DELETE event
  // which updates our state automatically
};
```

### 3. Missing Realtime Cleanup

**BAD:**
```typescript
// No cleanup - subscription leaks
window.api.onItemAdded((item) => { ... });
```

**GOOD:**
```typescript
useEffect(() => {
  const unsub = window.api.onItemAdded((item) => { ... });
  return () => unsub?.();  // Clean up on unmount
}, []);
```

### 4. Blocking Background Sync Indicator

**BAD:** Showing loading spinners for background refreshes, blocking the UI.

**GOOD:** Show cached data immediately, let realtime handle updates invisibly.

---

## Adding a New Feature Checklist

### If the feature needs Supabase sync:

1. **Define types** in `electron/main/types/yourfeature.ts`
2. **Create manager class** in `electron/main/yourSync.ts`
   - Extend `EventEmitter`
   - Add realtime subscription if collaborative
   - Emit events for state changes
3. **Wire up IPC handlers** in `electron/main/index.ts`
   - Forward manager events to renderer windows
4. **Expose in preload.ts**
   - Add API object with methods and event listeners
5. **Declare types** in `src/types/window.d.ts`
6. **Create React component** that:
   - Initializes from cache
   - Subscribes to realtime events in useEffect
   - Updates cache on state changes

### If the feature is local-only:

1. **Define types** in `electron/main/types/yourfeature.ts`
2. **Create manager class** or add to existing manager
3. **Wire up IPC handlers** in `electron/main/index.ts`
4. **Expose in preload.ts**
5. **Declare types** in `src/types/window.d.ts`
6. **Create React component**

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Electron** | Need native OS integration (hotkeys, clipboard, tray) |
| **SQLite for local** | Fast, reliable, embedded, FTS5 for search |
| **Supabase for cloud** | Auth, database, realtime, storage in one |
| **Realtime over polling** | Lower latency, less network traffic, simpler code |
| **localStorage cache** | Instant display, works offline, survives restarts |
| **EventEmitter pattern** | Decouples managers from IPC, testable |
| **TypeScript everywhere** | Type safety across IPC boundary |

---

## Testing Locally

```bash
# Development mode with hot reload
npm run dev

# Type check
npx tsc --noEmit

# Build for production
npm run build

# Package for distribution
npm run package
```

---

*Last updated: December 2024*
