<!-- 84218df3-c37a-4d0f-89e1-e5340ab95d00 c04c045d-d1ec-4342-aed6-447cd433c7e2 -->
# Supabase Integration Plan

## Overview

Add cloud storage via Supabase while maintaining offline-first functionality. Users can authenticate via email/password, manually sync their data, and optionally migrate existing local data to the cloud.

## Database Schema

Create four main tables in Supabase:

**users** (handled by Supabase Auth automatically)

**todos**

- id (uuid, primary key)
- user_id (uuid, foreign key to auth.users)
- text (text)
- completed (boolean)
- created_at (timestamp)
- updated_at (timestamp)
- deleted (boolean, for soft deletes)

**observations**

- id (uuid, primary key)
- user_id (uuid, foreign key to auth.users)
- text (text)
- created_at (timestamp)
- updated_at (timestamp)
- deleted (boolean)

**transcripts**

- id (uuid, primary key)
- user_id (uuid, foreign key to auth.users)
- text (text)
- created_at (timestamp)
- updated_at (timestamp)
- deleted (boolean)

Enable Row Level Security (RLS) on all tables to ensure users can only access their own data.

## Implementation Steps

### 1. Install Supabase Dependencies

Add `@supabase/supabase-js` and configure it for React Native (requires custom `AsyncStorage` adapter).

### 2. Create Supabase Service (`services/supabase.ts`)

- Initialize Supabase client with project URL and anon key
- Configure AsyncStorage adapter for auth persistence
- Export client singleton

### 3. Create Auth Service (`services/auth.ts`)

- Sign up with email/password
- Sign in with email/password
- Sign out
- Get current user
- Listen to auth state changes

### 4. Add Authentication UI

Create auth screens:

- Login screen (email/password input)
- Sign up screen
- Add auth modal/flow to `App.tsx`
- Show auth gate before main app content
- Add "Sign Out" option in settings

### 5. Update Storage Service (`services/storage.ts`)

Enhance `StorageService` to work with both local (AsyncStorage) and cloud (Supabase):

- Keep existing AsyncStorage methods for offline mode
- Add new methods for syncing with Supabase
- Implement sync logic:
- `syncTodos()` - push local changes to cloud, pull cloud changes
- `syncObservations()` - push local changes to cloud
- `syncTranscripts()` - push local changes to cloud
- `syncAll()` - sync everything
- Track sync status (last synced timestamp, pending changes)
- Handle conflicts (cloud timestamp wins, or last-write-wins)

### 6. Add Sync UI

- Add sync button in header or settings
- Show sync status indicator (syncing, last synced time, pending changes)
- Show sync errors with retry option
- Add visual feedback during sync

### 7. Optional Migration Flow

When user first authenticates:

- Check if local data exists (AsyncStorage)
- If yes, show modal: "Upload X todos, Y observations, Z transcripts to cloud?"
- If user confirms, upload all local data to Supabase
- Mark migration as complete in local storage (don't ask again)

### 8. Offline Support

- All CRUD operations continue to work with AsyncStorage
- Queue changes locally when offline
- Sync when user manually triggers or when connection restores
- Add "offline" indicator in UI when no connection

### 9. Update Type Definitions (`types/index.ts`)

Add types for:

- `AuthUser` - user profile
- `SyncStatus` - sync state tracking
- `SyncConflict` - conflict resolution data

### 10. Environment Variables

Add to `.env` (and document in README):

- `SUPABASE_URL` - your project URL
- `SUPABASE_ANON_KEY` - your public anon key

## Key Design Decisions

**Offline-First Architecture**

- AsyncStorage remains source of truth locally
- Supabase is backup/sync destination
- App works fully offline, syncs when user wants

**Manual Sync**

- User controls when data syncs (via sync button)
- Clear feedback about sync status
- No automatic background sync (simpler, more predictable)

**Soft Deletes**

- Don't actually delete records from Supabase
- Mark as `deleted = true` to handle sync conflicts
- Allows recovery and proper multi-device sync

**UUID Migration**

- Current IDs are timestamp-based strings
- Supabase uses UUIDs
- Keep local IDs, map to Supabase UUIDs during sync
- Store mapping in AsyncStorage for consistency

## Files to Modify

- `package.json` - add `@supabase/supabase-js`
- `services/supabase.ts` - NEW - Supabase client setup
- `services/auth.ts` - NEW - authentication logic
- `services/storage.ts` - MODIFY - add sync methods
- `types/index.ts` - MODIFY - add auth/sync types
- `App.tsx` - MODIFY - add auth gate and sync UI
- `components/AuthScreen.tsx` - NEW - login/signup UI
- `.env.example` - NEW - document environment variables

## Testing Checklist

- [ ] User can sign up with email/password
- [ ] User can sign in with email/password  
- [ ] User can sign out
- [ ] Todos sync to Supabase
- [ ] Observations sync to Supabase
- [ ] Transcripts sync to Supabase
- [ ] App works offline (CRUD with AsyncStorage)
- [ ] Manual sync uploads pending changes
- [ ] Optional migration uploads existing local data
- [ ] RLS prevents access to other users' data
- [ ] Sync conflicts resolve correctly

### To-dos

- [ ] Install Supabase dependencies and create environment config
- [ ] Create database tables and RLS policies in Supabase
- [ ] Create Supabase client service with AsyncStorage adapter
- [ ] Build authentication service with email/password methods
- [ ] Create authentication screens (login/signup)
- [ ] Add auth gate to App.tsx and settings sign out
- [ ] Add Supabase sync methods to StorageService
- [ ] Add sync button and status indicators to UI
- [ ] Implement optional local data migration on first login
- [ ] Test offline mode and sync conflict resolution