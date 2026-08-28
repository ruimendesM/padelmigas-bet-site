-- 0003_rls_deny_anon.sql
--
-- Deny-by-default on every table (constitution, Principle IV; FR-022).
--
-- RLS is enabled with NO policies, which in Postgres means "no rows for anyone but the owner and
-- roles with BYPASSRLS". Privileges are revoked as well, so `anon` and `authenticated` cannot even
-- attempt a read: there is no direct write path to ballots, pairs, players or tournaments, and no
-- path at all by which one voter's ballot could be read.
--
-- All access is through packages/db over the pooled connection using the credential in
-- DATABASE_URL (ADR-003, as amended).

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'players',
    'player_ratings',
    'tournaments',
    'groups',
    'pairs',
    'voters',
    'ballots',
    'ballot_entries',
    'group_final_standings'
  ]
  loop
    execute format('alter table public.%I enable row level security', tbl);
    -- FORCE applies RLS to the table owner too, so a future policy mistake cannot be masked by
    -- happening to connect as the owner.
    execute format('alter table public.%I force row level security', tbl);
  end loop;
end
$$;

-- Strip every default grant. `anon` is the role a leaked publishable key would map to; it gets
-- nothing. `authenticated` is unused in phase 1 (Supabase Auth is disabled) and also gets nothing.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on all tables in schema public from %I', role_name);
      execute format('revoke all on all sequences in schema public from %I', role_name);
      execute format('revoke all on all functions in schema public from %I', role_name);
      execute format('revoke usage on schema public from %I', role_name);
      -- Future tables inherit nothing either.
      execute format(
        'alter default privileges in schema public revoke all on tables from %I', role_name);
      execute format(
        'alter default privileges in schema public revoke all on sequences from %I', role_name);
      execute format(
        'alter default privileges in schema public revoke all on functions from %I', role_name);
    end if;
  end loop;
end
$$;

-- The aggregate views inherit the base tables' protection, but revoke explicitly so a future
-- `grant select on all tables` cannot quietly re-expose them.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on public.group_position_counts from %I', role_name);
      execute format('revoke all on public.group_ballot_counts from %I', role_name);
    end if;
  end loop;
end
$$;

-- rollback:
-- -- Restores the Supabase default grants. Only do this knowingly: it re-opens the anon role's
-- -- read path, which FR-022 and SC-006 forbid.
-- --
-- -- Role-guarded exactly like the forward path: `anon` and `authenticated` are Supabase-created
-- -- roles and do not exist on a plain Postgres (a scratch CI database, or a local instance).
-- do $$
-- declare
--   tbl text;
-- begin
--   foreach tbl in array array['players','player_ratings','tournaments','groups','pairs',
--                              'voters','ballots','ballot_entries','group_final_standings']
--   loop
--     execute format('alter table public.%I no force row level security', tbl);
--     execute format('alter table public.%I disable row level security', tbl);
--   end loop;
-- end
-- $$;
-- do $$
-- declare
--   role_name text;
-- begin
--   foreach role_name in array array['anon', 'authenticated']
--   loop
--     if exists (select 1 from pg_roles where rolname = role_name) then
--       execute format('grant usage on schema public to %I', role_name);
--       execute format('grant all on all tables in schema public to %I', role_name);
--       execute format('grant all on all sequences in schema public to %I', role_name);
--       execute format('grant all on all functions in schema public to %I', role_name);
--       execute format(
--         'alter default privileges in schema public grant all on tables to %I', role_name);
--       execute format(
--         'alter default privileges in schema public grant all on sequences to %I', role_name);
--       execute format(
--         'alter default privileges in schema public grant all on functions to %I', role_name);
--     end if;
--   end loop;
-- end
-- $$;
