-- 0004_indexes.sql
--
-- Indexes from data-model.md. Nothing speculative: each one names the read path that needs it.
-- The UNIQUE constraints in 0001 already index players (match_key), players (external_id),
-- ballots (group_id, voter_id), pairs (group_id, seed) and tournaments (slug), so those are absent
-- here on purpose.

-- Every aggregation path groups ballots by group.
create index ballots_group_id_idx on ballots (group_id);

-- Per-pair position breakdowns (FR-016).
create index ballot_entries_pair_id_idx on ballot_entries (pair_id);

-- Page loads walk tournament -> groups -> pairs.
create index pairs_group_id_idx on pairs (group_id);
create index groups_tournament_id_idx on groups (tournament_id);

-- Player history joins through both pair slots (FR-025).
create index pairs_player_1_id_idx on pairs (player_1_id);
create index pairs_player_2_id_idx on pairs (player_2_id);

-- Landing and history lists order by publication, newest first (FR-023). Partial: drafts are never
-- listed, so they do not belong in the index.
create index tournaments_published_at_desc_idx
  on tournaments (published_at desc)
  where published_at is not null;

-- rollback:
-- drop index if exists tournaments_published_at_desc_idx;
-- drop index if exists pairs_player_2_id_idx;
-- drop index if exists pairs_player_1_id_idx;
-- drop index if exists groups_tournament_id_idx;
-- drop index if exists pairs_group_id_idx;
-- drop index if exists ballot_entries_pair_id_idx;
-- drop index if exists ballots_group_id_idx;
