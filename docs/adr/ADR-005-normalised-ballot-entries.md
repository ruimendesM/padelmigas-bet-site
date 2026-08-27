# ADR-005: Store Ballots as One Row per Pair-Position

## Status
Accepted — 2026-08-27

## Context
A ballot is an ordering of a group's pairs: six `(pair, position)` assignments. It could be stored as
one JSON column on the ballot row, or normalised into child rows. Two forces matter: the aggregation
query runs on every results view and counts, per pair, how many ballots placed it at each position;
and a malformed ballot (a repeated position, a pair ranked twice) must be impossible to persist, not
merely unlikely.

## Decision
Store `ballots` (one row per voter per group) plus `ballot_entries` with primary key
`(ballot_id, pair_id)` and `UNIQUE (ballot_id, position)`. Insert the ballot and all its entries in
one transaction. Aggregate with a plain grouped count in the `group_position_counts` view.

## Consequences

### Positive
- A repeated position or a twice-ranked pair is rejected by the database, independently of
  application code.
- Aggregation is `GROUP BY group_id, pair_id, position` — no JSON traversal, indexable, and cheap.
- Adding real final standings later compares two tables of the same shape.
- A partially written ballot cannot exist: the transaction either lands whole or not at all.

### Negative
- Six rows per ballot instead of one; a 500-ballot tournament with four groups holds ~12k entry rows
  (trivial, but not zero).
- Reading one voter's own ballot needs a join rather than a single column read.
- Two tables to keep in step in the repository implementation.

### Neutral
- Completeness of the ordering (every pair present, positions forming `1..n`) still has to be checked
  in `packages/core/ballot`; the database can enforce uniqueness but not group membership without a
  trigger, which is not worth adding at this scale.

## Alternatives Considered
- **JSON column on `ballots`** — one row per ballot, simplest write path. Rejected because every
  validity rule becomes application-only and aggregation becomes JSON unnesting on every page view.
- **Array column of pair ids in position order** — compact and ordering is implicit. Rejected for the
  same reasons, plus fragility if a pair is ever removed from a group.
- **Materialised aggregate counters updated on write** — fastest reads. Rejected as premature: the
  grouped count over a few thousand rows is already sub-millisecond, and counters introduce a
  consistency problem that does not otherwise exist.

## References
- [data-model.md](../../specs/001-group-standings-voting/data-model.md) — `ballot_entries`
- [spec.md](../../specs/001-group-standings-voting/spec.md) — FR-010, FR-013
