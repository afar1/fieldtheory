-- Enable UUID generation for pgcrypto-based UUIDs.
create extension if not exists pgcrypto;

-- Profiles mirror auth.users (one row per Supabase user).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

-- Todos data captured on device (client_id ensures dedupe by device id).
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  completed boolean not null default false,
  client_id text not null,
  client_created_at_ms bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint todos_unique_client_per_user unique (user_id, client_id)
);

-- Observations captured on device.
create table if not exists public.observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  client_id text not null,
  client_created_at_ms bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint observations_unique_client_per_user unique (user_id, client_id)
);

-- Transcript entries captured on device.
create table if not exists public.transcripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  client_id text not null,
  client_created_at_ms bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transcripts_unique_client_per_user unique (user_id, client_id)
);
