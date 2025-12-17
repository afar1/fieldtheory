-- =============================================================================
-- Social Messaging - DMs, Feedback, and Contacts
-- Consolidates messaging features into unified tables.
-- =============================================================================

-- =============================================================================
-- Profiles table - extends user info with admin flag and hot mic preference.
-- If you already have a profiles table, add these columns instead of creating.
-- =============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  first_name text,
  last_name text,
  is_admin boolean not null default false,
  hot_mic_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS on profiles.
alter table public.profiles enable row level security;

-- Users can read any profile (needed for display names).
create policy "Users can read all profiles"
  on public.profiles
  for select
  to authenticated
  using (true);

-- Users can only update their own profile.
create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Users can insert their own profile.
create policy "Users can insert own profile"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

-- Trigger to auto-create profile on user signup.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- Only create trigger if it doesn't exist.
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'on_auth_user_created_profile'
  ) then
    create trigger on_auth_user_created_profile
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end $$;

-- Updated_at trigger for profiles.
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.handle_updated_at();

-- =============================================================================
-- Contacts table - replaces team_members.
-- Stores both team relationships and friend relationships.
-- relationship_type: 'team' for work teammates, 'friend' for personal contacts.
-- If null, treated as 'friend'.
-- =============================================================================

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  
  -- The user who owns this contact (who added them).
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  
  -- The contact's email (case-insensitive matching).
  contact_email text not null,
  
  -- The contact's user ID (populated when they have an account).
  contact_user_id uuid references auth.users (id) on delete set null,
  
  -- Type of relationship: 'team' for teammates, 'friend' for personal.
  -- Null is treated as 'friend'.
  relationship_type text check (relationship_type in ('team', 'friend')),
  
  -- Status of the contact: 'pending' until they sign up or accept.
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  
  created_at timestamptz not null default now(),
  
  -- One contact per (owner, email) pair.
  constraint contacts_unique_pair unique (owner_user_id, contact_email)
);

-- Indexes for efficient querying.
create index if not exists idx_contacts_owner on public.contacts(owner_user_id);
create index if not exists idx_contacts_email on public.contacts(lower(contact_email));
create index if not exists idx_contacts_user_id on public.contacts(contact_user_id);

-- Enable RLS.
alter table public.contacts enable row level security;

-- Users can see contacts they own OR where they are the contact.
create policy "Users can see their contacts"
  on public.contacts
  for select
  to authenticated
  using (
    owner_user_id = auth.uid() 
    or contact_user_id = auth.uid()
    or lower(contact_email) = lower(auth.jwt() ->> 'email')
  );

-- Users can add their own contacts.
create policy "Users can add contacts"
  on public.contacts
  for insert
  to authenticated
  with check (owner_user_id = auth.uid());

-- Users can update their own contacts.
create policy "Users can update own contacts"
  on public.contacts
  for update
  to authenticated
  using (owner_user_id = auth.uid());

-- Users can delete their own contacts OR remove themselves from someone's contacts.
create policy "Users can delete contacts"
  on public.contacts
  for delete
  to authenticated
  using (
    owner_user_id = auth.uid() 
    or contact_user_id = auth.uid()
    or lower(contact_email) = lower(auth.jwt() ->> 'email')
  );

-- =============================================================================
-- Helper function: Get all user IDs that are contacts of the current user.
-- Returns users where current user owns the contact OR is the contact.
-- =============================================================================

create or replace function public.get_contact_user_ids()
returns setof uuid as $$
declare
  current_email text;
begin
  current_email := auth.jwt() ->> 'email';
  
  -- Return current user.
  return next auth.uid();
  
  -- Return contacts I own (who have accounts).
  return query
    select c.contact_user_id from public.contacts c
    where c.owner_user_id = auth.uid()
    and c.contact_user_id is not null
    and c.status = 'accepted';
  
  -- Return users who added me as a contact.
  return query
    select c.owner_user_id from public.contacts c
    where (c.contact_user_id = auth.uid() or lower(c.contact_email) = lower(current_email))
    and c.status = 'accepted';
end;
$$ language plpgsql security definer stable;

-- =============================================================================
-- Messages table - unified table for DMs and Feedback.
-- type: 'dm' for direct messages, 'feedback' for user-to-admin feedback.
-- =============================================================================

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  
  -- Message type: 'dm' or 'feedback'.
  type text not null check (type in ('dm', 'feedback')),
  
  -- Sender and recipient.
  sender_user_id uuid not null references auth.users (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  
  -- Content type and data.
  content_type text not null check (content_type in ('text', 'image', 'stack')),
  content_text text,
  image_path text,  -- Path in storage bucket.
  stack_id uuid,    -- Reference to a stack if content_type is 'stack'.
  source_item_id uuid,  -- Original clipboard item this was created from.
  
  -- DM-specific: when the message was read.
  read_at timestamptz,
  
  -- Feedback-specific: status workflow.
  feedback_status text check (feedback_status in ('open', 'resolved', 'archived')),
  
  -- For reply threads (feedback chat).
  parent_message_id uuid references public.messages (id) on delete cascade,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for efficient querying.
create index if not exists idx_messages_sender on public.messages(sender_user_id);
create index if not exists idx_messages_recipient on public.messages(recipient_user_id);
create index if not exists idx_messages_type on public.messages(type);
create index if not exists idx_messages_created_at on public.messages(created_at desc);
create index if not exists idx_messages_parent on public.messages(parent_message_id);
create index if not exists idx_messages_feedback_status on public.messages(feedback_status) where type = 'feedback';

-- Enable RLS.
alter table public.messages enable row level security;

-- Users can read messages they sent or received.
create policy "Users can read their messages"
  on public.messages
  for select
  to authenticated
  using (
    sender_user_id = auth.uid() 
    or recipient_user_id = auth.uid()
  );

-- Users can send messages (insert).
create policy "Users can send messages"
  on public.messages
  for insert
  to authenticated
  with check (sender_user_id = auth.uid());

-- Users can update messages they're involved in.
-- Sender can update their own message.
-- Recipient can mark as read.
-- Both can update feedback status (with restrictions in app logic).
create policy "Users can update their messages"
  on public.messages
  for update
  to authenticated
  using (sender_user_id = auth.uid() or recipient_user_id = auth.uid());

-- Users can delete messages they sent.
create policy "Users can delete their sent messages"
  on public.messages
  for delete
  to authenticated
  using (sender_user_id = auth.uid());

-- Updated_at trigger for messages.
create trigger set_messages_updated_at
  before update on public.messages
  for each row
  execute function public.handle_updated_at();

-- =============================================================================
-- Message Activity Log - tracks status changes and replies for feedback.
-- =============================================================================

create table if not exists public.message_activity_log (
  id uuid primary key default gen_random_uuid(),
  
  -- The message this activity is for.
  message_id uuid not null references public.messages (id) on delete cascade,
  
  -- Who performed the action.
  user_id uuid not null references auth.users (id) on delete cascade,
  
  -- What happened.
  action text not null check (action in ('created', 'status_changed', 'replied')),
  
  -- For status changes: old and new status.
  old_status text,
  new_status text,
  
  created_at timestamptz not null default now()
);

-- Index for looking up activity by message.
create index if not exists idx_activity_log_message on public.message_activity_log(message_id);

-- Enable RLS.
alter table public.message_activity_log enable row level security;

-- Users can read activity for messages they're involved in.
create policy "Users can read activity for their messages"
  on public.message_activity_log
  for select
  to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id
      and (m.sender_user_id = auth.uid() or m.recipient_user_id = auth.uid())
    )
  );

-- Users can insert activity for messages they're involved in.
create policy "Users can add activity for their messages"
  on public.message_activity_log
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
      and (m.sender_user_id = auth.uid() or m.recipient_user_id = auth.uid())
    )
  );

-- =============================================================================
-- Enable Realtime for messages table.
-- This allows clients to subscribe to new messages.
-- =============================================================================

alter publication supabase_realtime add table public.messages;

-- =============================================================================
-- Migration: Copy existing team_members to contacts.
-- Run this AFTER creating the tables above.
-- =============================================================================

-- Insert existing team_members as contacts with relationship_type = 'team'.
insert into public.contacts (owner_user_id, contact_email, contact_user_id, relationship_type, status, created_at)
select 
  tm.added_by_user_id as owner_user_id,
  tm.member_email as contact_email,
  u.id as contact_user_id,
  'team' as relationship_type,
  'accepted' as status,
  tm.created_at
from public.team_members tm
left join auth.users u on lower(u.email) = lower(tm.member_email)
on conflict (owner_user_id, contact_email) do nothing;

-- =============================================================================
-- Backfill profiles for existing users.
-- =============================================================================

insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

