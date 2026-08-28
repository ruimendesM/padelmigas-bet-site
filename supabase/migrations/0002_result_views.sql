-- 0002_result_views.sql
--
-- Counting happens here; percentages, mean position, crowd ordering and tie-breaks happen in
-- packages/core/scoring (ADR-006). The split is deliberate: SQL is fast at grouped counts and bad
-- at being unit-tested, and the formula is the part users can see is wrong.
--
-- These views expose counts only. The reveal gate (FR-020, FR-021) is a per-request decision made
-- in packages/api, not here — a view cannot know who is asking.

create view group_position_counts as
select b.group_id,
       e.pair_id,
       e.position,
       count(*)::int as votes
from ballot_entries e
join ballots b on b.id = e.ballot_id
group by b.group_id, e.pair_id, e.position;

comment on view group_position_counts is
  'Ballots placing each pair at each position, per group. Feeds packages/core/scoring (ADR-006).';

create view group_ballot_counts as
select group_id,
       count(*)::int as ballot_count
from ballots
group by group_id;

comment on view group_ballot_counts is
  'Ballots cast per group. N = 0 yields no row, which the scoring function reads as '
  '"no votes yet" — division by zero is impossible by construction (FR-019).';

-- rollback:
-- drop view if exists group_ballot_counts;
-- drop view if exists group_position_counts;
