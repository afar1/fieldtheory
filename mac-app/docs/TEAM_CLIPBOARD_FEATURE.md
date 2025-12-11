# Team Clipboard Feature

The Team Clipboard enables collaborative clipboard sharing between users signed into the same account. Users can share items to a communal clipboard that's accessible to all team members.

## Overview

When you have two or more users signed into the same account on different devices:
- Anyone can **share** clipboard items (text, transcripts, screenshots) to the team clipboard
- All team members can **view** shared items in the Team tab
- Team members can **copy items to personal** clipboard for local use
- Teams can **create and modify stacks** in the team view (same mechanics as personal clipboard)
- Once copied to personal, items become **independent snapshots** - changes to the team stack don't affect personal copies

## Architecture

### Database (Supabase)

Two new tables in `supabase/migrations/007_team_clipboard.sql`:

1. **`team_clipboard_items`** - Stores shared clipboard items
   - Links to user via `user_id`
   - Supports stacking via `stack_id`
   - Stores both text content and image data
   - Tracks who shared the item via `shared_by_email`

2. **`team_clipboard_stacks`** - Metadata for team stacks
   - Tracks who created each stack
   - Optional stack naming

### Backend (Electron Main Process)

**`TeamClipboardSync`** class in `electron/main/teamClipboardSync.ts`:
- Manages syncing with Supabase
- Shares Supabase client with MobileSync
- Key operations:
  - `queryItems()` - Fetch team items with filters
  - `shareToTeam()` - Share a local item to team
  - `shareStackToTeam()` - Share a stack to team
  - `copyToPersonal()` - Copy a team item to local clipboard
  - `copyStackToPersonal()` - Copy a team stack to local clipboard
  - `updateStackId()` - Move items between stacks
  - `getStacks()` - Get stack summaries

### IPC Channels

Defined in `electron/main/types/clipboard.ts`:

```typescript
TeamClipboardIPCChannels = {
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

Exposed via `preload.ts` as `window.teamClipboardAPI`:

```typescript
interface TeamClipboardAPI {
  queryItems: (options?) => Promise<TeamClipboardItem[]>;
  getItem: (id) => Promise<TeamClipboardItem | null>;
  shareToTeam: (localItemId) => Promise<TeamClipboardItem | null>;
  shareStackToTeam: (localItemIds) => Promise<string | null>;
  deleteItem: (id) => Promise<boolean>;
  updateStackId: (itemIds, stackId) => Promise<boolean>;
  copyToPersonal: (teamItemId) => Promise<number | null>;
  copyStackToPersonal: (teamStackId) => Promise<number[]>;
  getStacks: () => Promise<TeamStackInfo[]>;
  onTeamItemAdded?: (callback) => () => void;
  onTeamItemDeleted?: (callback) => () => void;
}
```

### UI (ClipboardHistory Component)

The ClipboardHistory component now has three view modes:
1. **My Clipboard** - Personal clipboard items (default)
2. **Team** - Shared team items
3. **Todos** - Todo list

Key UI additions:
- **View mode tabs** at the top for switching between modes
- **Share to Team button** in the selection action bar
- **Team view** showing shared items with "Copy to My Clipboard" button
- **Shared by email** displayed for each team item

## Usage Flow

### Sharing to Team

1. Select one or more items in personal clipboard (click, Cmd+Click, Shift+Click)
2. Click "↑ share to team" button in the selection bar
3. Items are uploaded to Supabase and appear in the Team view for all users

### Viewing Team Items

1. Click the "Team" tab
2. Browse shared items from all team members
3. See who shared each item and when

### Copying to Personal

1. In Team view, find an item you want
2. Click "Copy to My Clipboard" button
3. A local copy is created in your personal clipboard
4. This copy is now independent - future team changes don't affect it

## Security

- Row Level Security (RLS) on Supabase tables
- All authenticated users can read team items
- Only owners can update/delete their own items
- Anyone can update stack assignments (collaborative stacking)

## Future Enhancements

Potential improvements:
- Real-time sync using Supabase subscriptions
- Stack naming
- Permissions (who can modify vs. just view)
- Team workspace management (multiple teams)
- Activity feed showing recent shares
