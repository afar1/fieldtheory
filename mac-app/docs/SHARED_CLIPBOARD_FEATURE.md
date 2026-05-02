# Shared Clipboard Feature

Status: historical design only.

Shared Clipboard is disabled for release.
Field Theory must not sync clipboard items, including for internal users.
The renderer preload keeps the old `window.sharedClipboardAPI` shape for compatibility, but every method is a no-op or returns an empty result.

The original design below is retained only as implementation history.

The Shared Clipboard was designed to enable collaborative clipboard sharing between users signed into the same account. Users could share items to a communal clipboard that's accessible to all team members.

## Overview

When you have two or more users signed into the same account on different devices:
- Anyone can **share** clipboard items (text, transcripts, screenshots) to the shared clipboard
- All team members can **view** shared items in the Shared Clipboard tab
- Team members can **copy items to personal** clipboard for local use
- Teams can **create and modify stacks** in the shared view (same mechanics as personal clipboard)
- Once copied to personal, items become **independent snapshots** - changes to the shared stack don't affect personal copies

## Architecture

### Database (Supabase)

Two new tables in `supabase/migrations/007_team_clipboard.sql`:

1. **`team_clipboard_items`** - Stores shared clipboard items
   - Links to user via `user_id`
   - Supports stacking via `stack_id`
   - Stores both text content and image data
   - Tracks who shared the item via `shared_by_email`

2. **`team_clipboard_stacks`** - Metadata for shared stacks
   - Tracks who created each stack
   - Optional stack naming

### Backend (Electron Main Process)

**`SharedClipboardSync`** class in `electron/main/sharedClipboardSync.ts`:
- Manages syncing with Supabase
- Shares Supabase client with MobileSync
- Key operations:
  - `queryItems()` - Fetch shared items with filters
  - `shareToTeam()` - Share a local item to shared clipboard
  - `shareStackToTeam()` - Share a stack to shared clipboard
  - `copyToPersonal()` - Copy a shared item to local clipboard
  - `copyStackToPersonal()` - Copy a shared stack to local clipboard
  - `updateStackId()` - Move items between stacks
  - `getStacks()` - Get stack summaries

### IPC Channels

Defined in `electron/main/types/clipboard.ts`:

```typescript
SharedClipboardIPCChannels = {
  QUERY_TEAM_ITEMS: 'teamClipboard:queryItems',
  GET_TEAM_ITEM: 'teamClipboard:getItem',
  SHARE_TO_TEAM: 'teamClipboard:shareItem',
  SHARE_STACK_TO_TEAM: 'teamClipboard:shareStack',
  DELETE_TEAM_ITEM: 'teamClipboard:deleteItem',
  UPDATE_TEAM_STACK_ID: 'teamClipboard:updateStackId',
  COPY_TO_PERSONAL: 'teamClipboard:copyToPersonal',
  COPY_STACK_TO_PERSONAL: 'teamClipboard:copyStackToPersonal',
  GET_TEAM_STACKS: 'teamClipboard:getStacks',
  CREATE_TEAM_STACK: 'teamClipboard:createStack',
  TEAM_ITEM_ADDED: 'teamClipboard:itemAdded',
  TEAM_ITEM_DELETED: 'teamClipboard:itemDeleted',
}
```

### Renderer API

Exposed via `preload.ts` as `window.sharedClipboardAPI`:

```typescript
interface SharedClipboardAPI {
  queryItems: (options?) => Promise<SharedClipboardItem[]>;
  getItem: (id) => Promise<SharedClipboardItem | null>;
  shareToTeam: (localItemId) => Promise<SharedClipboardItem | null>;
  shareStackToTeam: (localItemIds) => Promise<string | null>;
  deleteItem: (id) => Promise<boolean>;
  updateStackId: (itemIds, stackId) => Promise<boolean>;
  copyToPersonal: (sharedItemId) => Promise<number | null>;
  copyStackToPersonal: (sharedStackId) => Promise<number[]>;
  getStacks: () => Promise<SharedStackInfo[]>;
  onSharedItemAdded?: (callback) => () => void;
  onSharedItemDeleted?: (callback) => () => void;
}
```

### UI (ClipboardHistory Component)

The ClipboardHistory component now has three view modes:
1. **My Clipboard** - Personal clipboard items (default)
2. **Shared Clipboard** - Shared clipboard items
3. **Todos** - Todo list

Key UI additions:
- **View mode tabs** at the top for switching between modes
- **Share to Shared Clipboard button** in the selection action bar
- **Shared view** showing shared items with "Copy to My Clipboard" button
- **Shared by email** displayed for each shared item

## Usage Flow

This flow is not available in the release build.

### Sharing to Shared Clipboard

1. Select one or more items in personal clipboard (click, Cmd+Click, Shift+Click)
2. Click "↑ share" button in the selection bar
3. Items are uploaded to Supabase and appear in the Shared Clipboard view for all users

### Viewing Shared Items

1. Click the "Shared Clipboard" tab
2. Browse shared items from all team members
3. See who shared each item and when

### Copying to Personal

1. In Shared Clipboard view, find an item you want
2. Click "Copy to My Clipboard" button
3. A local copy is created in your personal clipboard
4. This copy is now independent - future shared changes don't affect it

## Security

- Row Level Security (RLS) on Supabase tables
- All authenticated users can read shared items
- Only owners can update/delete their own items
- Anyone can update stack assignments (collaborative stacking)

## Future Enhancements

Potential improvements:
- Real-time sync using Supabase subscriptions
- Stack naming
- Permissions (who can modify vs. just view)
- Team workspace management (multiple teams)
- Activity feed showing recent shares
