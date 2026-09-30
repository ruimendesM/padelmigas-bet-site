-- 0007_tournament_replacement.sql
--
-- Replacing an open tournament with a corrected lineup (feature 003, data-model.md).
--
-- The original is kept as history rather than deleted or edited in place: it gains an invalidation
-- instant and a link to the tournament that replaced it. Ballots on groups the replacement left
-- unchanged are copied into the replacement's groups, so every existing read path — the count views,
-- the one-ballot constraint, the voter's own ballot — works on the replacement untouched, while the
-- original keeps its own ballots as the frozen record (FR-207, research R1).

alter table tournaments
  add column invalidated_at timestamptz,
  add column replaced_by_id uuid references tournaments (id);

-- Both or neither: an invalidated tournament always says what replaced it, so following the chain
-- from any invalidated tournament reaches exactly one live one (spec: Key Entities).
alter table tournaments
  add constraint tournaments_invalidation_complete
    check ((invalidated_at is null) = (replaced_by_id is null)),
  add constraint tournaments_not_self_replaced
    check (replaced_by_id <> id);

comment on column tournaments.invalidated_at is
  'Set once, when the tournament is replaced (FR-204). Never cleared: there is no restore.';
comment on column tournaments.replaced_by_id is
  'The direct replacement. Follow until invalidated_at is null to reach the live tournament.';

alter table ballots
  add column carried_from_id uuid references ballots (id);

comment on column ballots.carried_from_id is
  'Set on a ballot copied into a replacement group from the unchanged original group (FR-207).';

-- rollback:
-- alter table ballots drop column if exists carried_from_id;
-- alter table tournaments drop constraint if exists tournaments_not_self_replaced;
-- alter table tournaments drop constraint if exists tournaments_invalidation_complete;
-- alter table tournaments drop column if exists replaced_by_id;
-- alter table tournaments drop column if exists invalidated_at;
-- -- Lossy after use: a replaced original would reappear as live at its derived slug. Re-slug or
-- -- delete it by hand first (data-model.md § Rollback).
