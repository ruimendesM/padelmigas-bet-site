-- 0008_voter_accounts.sql
--
-- Optional voter accounts (feature 004, data-model.md, ADR-012).
--
-- An account is a self-chosen username and an argon2id password hash that owns exactly one existing
-- `voters` row. Ballots keep referencing voters, so the one-ballot rule, the count views and every
-- read path are untouched: signing in only changes which voter the caller resolves to. No email and
-- no other personal data is stored (constitution v1.1.0, Voter identity).

create table accounts (
  id                             uuid primary key default gen_random_uuid(),
  -- Stored already lower-cased, so a plain unique constraint is case-insensitive uniqueness
  -- (FR-303) without the citext extension.
  username                       text        not null unique
    constraint accounts_username_format check (username ~ '^[a-z0-9._-]{3,30}$'),
  -- argon2id encoded hash. Never selected into a response (FR-306).
  password_hash                  text        not null,
  -- The voter this account owns. Unique: one account, one voter, one ballot per group (FR-308).
  voter_id                       uuid        not null unique references voters (id),
  -- Bumped by a password change or an organiser reset; a session token carrying an older value is
  -- no longer accepted (FR-318, FR-320, research R3).
  session_version                integer     not null default 1
    constraint accounts_session_version_positive check (session_version > 0),
  -- Set by an organiser reset to reset time + 24 h; null otherwise. Non-null means the stored hash
  -- is a temporary password that must be replaced at sign-in (FR-320, FR-321).
  temporary_password_expires_at  timestamptz,
  password_changed_at            timestamptz not null default now(),
  created_at                     timestamptz not null default now()
);

comment on table accounts is
  'Optional voter accounts (feature 004). Username + argon2id hash only; no email, no IP. '
  'Each account owns exactly one voter; ballots stay keyed on voter_id.';

comment on table voters is
  'Voter identities: anonymous cookie holders, or owned by exactly one account (feature 004). '
  'No IP, no user agent, no personal data (constitution: Privacy). Rate limiting keys on a salted IP '
  'hash held outside Postgres with a 10-minute TTL.';

-- Deny-by-default, as every other table (0003_rls_deny_anon.sql).
alter table public.accounts enable row level security;
alter table public.accounts force row level security;

do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on public.accounts from %I', role_name);
    end if;
  end loop;
end
$$;

-- rollback:
-- drop table if exists accounts;
-- comment on table voters is
--   'Anonymous voter identities. No IP, no user agent, no personal data (constitution: Privacy). '
--   'Rate limiting keys on a salted IP hash held outside Postgres with a 10-minute TTL.';
-- -- Lossy: account-owned voters and their ballots remain and keep counting, but can no longer be
-- -- reached by signing in.
