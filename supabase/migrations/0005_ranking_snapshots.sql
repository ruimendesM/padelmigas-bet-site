-- 0005_ranking_snapshots.sql
--
-- Raw CSV snapshots of the public ranking sheet.
--
-- Required by Risk R3's mitigation: "Sync stores the raw CSV snapshot and fails loudly instead of
-- guessing; ... last good snapshot serves imports meanwhile". Without somewhere to keep it, an
-- unreachable sheet leaves the import path with no honest fallback, and the only alternatives are
-- inventing players or blocking a publish — both rejected by FR-004.
--
-- Added during implementation; data-model.md records the same table.
--
-- Not the filesystem: the host is serverless and its disk does not survive an invocation.

create table ranking_snapshots (
  id          uuid primary key default gen_random_uuid(),
  -- The sheet exactly as fetched. Kept verbatim so a parsing change can be re-run against the same
  -- bytes that produced a past import.
  csv         text        not null check (length(csv) > 0),
  fetched_at  timestamptz not null,
  -- Rows the parser found, recorded for the staleness warning the organiser sees (Risk R3).
  row_count   integer     not null check (row_count >= 0),
  created_at  timestamptz not null default now()
);

comment on table ranking_snapshots is
  'Verbatim CSV snapshots of the ranking sheet (Risk R3). Contains real player names and points, '
  'which are already public on the sheet — no other personal data (constitution: Privacy).';

-- Only the newest snapshot is ever read.
create index ranking_snapshots_fetched_at_desc_idx on ranking_snapshots (fetched_at desc);

do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on public.ranking_snapshots from %I', role_name);
    end if;
  end loop;
end
$$;

alter table ranking_snapshots enable row level security;
alter table ranking_snapshots force row level security;

-- rollback:
-- drop index if exists ranking_snapshots_fetched_at_desc_idx;
-- drop table if exists ranking_snapshots;
