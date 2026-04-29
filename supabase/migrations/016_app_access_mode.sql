alter table public.profiles
add column if not exists app_access_mode text not null default 'active'
check (app_access_mode in ('active', 'read_only', 'disabled'));
