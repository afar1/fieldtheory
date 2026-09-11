-- Apply only edited keys, under a row lock, to preserve independent offline edits.
create table public.user_word_substitutions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pairs jsonb not null default '[]'::jsonb check (jsonb_typeof(pairs) = 'array')
);
alter table public.user_word_substitutions enable row level security;
create policy own_word_substitutions on public.user_word_substitutions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.user_word_substitutions to authenticated;

create function public.sync_word_substitutions(changes jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  account_id uuid := auth.uid();
  result jsonb;
  change jsonb;
begin
  if account_id is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes) > 2000 then
    raise exception 'Invalid word substitutions';
  end if;
  insert into public.user_word_substitutions(user_id) values (account_id) on conflict do nothing;
  select pairs into result from public.user_word_substitutions where user_id = account_id for update;
  for change in select value from jsonb_array_elements(changes) loop
    if jsonb_typeof(change->'from') is distinct from 'string' or length(change->>'from') = 0
      or length(change->>'from') > 500 or not (change ? 'to')
      or jsonb_typeof(change->'to') not in ('string', 'null')
      or length(change->>'to') > 2000 then
      raise exception 'Invalid word substitution';
    end if;
    if change->'to' = 'null'::jsonb then
      select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into result
        from jsonb_array_elements(result) with ordinality as entries(value, ordinal)
        where value->>'from' <> change->>'from';
    elsif exists (select 1 from jsonb_array_elements(result) pair where pair->>'from' = change->>'from') then
      select jsonb_agg(case when value->>'from' = change->>'from'
        then jsonb_build_object('from', change->>'from', 'to', change->>'to') else value end order by ordinal)
        into result from jsonb_array_elements(result) with ordinality as entries(value, ordinal);
    else
      result := result || jsonb_build_array(jsonb_build_object('from', change->>'from', 'to', change->>'to'));
    end if;
  end loop;
  update public.user_word_substitutions set pairs = result where user_id = account_id;
  return result;
end;
$$;
revoke all on function public.sync_word_substitutions(jsonb) from public, anon;
grant execute on function public.sync_word_substitutions(jsonb) to authenticated;
