# ADR-006: Count in SQL, Compute Percentages and Ordering in a Pure Function

## Status
Accepted — 2026-08-27

## Context
Results have two parts: counting how many ballots put each pair at each position, and turning those
counts into the numbers shown — per-position percentages, a mean predicted position, a crowd ordering,
and deterministic tie-breaks. Counting is what a database is for. The formula, by contrast, is product
logic that will be argued about, tweaked, and must behave identically on any future host; it is also
the single most testable piece of the system, with edge cases (zero ballots, exact ties, rounding)
that deserve unit tests rather than SQL fixtures.

## Decision
Split the two. `group_position_counts` and `group_ballot_counts` are plain SQL views returning raw
counts. `packages/core/scoring` is a pure function from those counts to the results object:

- `position_share(pair, p) = votes(pair, p) / N`
- `mean_position(pair) = Σ_p (p × votes(pair, p)) / N`
- crowd order: ascending `mean_position`, ties broken by descending first-place votes, then
  descending pair `total_points`, then ascending pair id
- `N = 0` produces no results object at all, so division by zero is unrepresentable

Rounding happens only at render time, never before ordering.

## Consequences

### Positive
- The formula is unit-tested exhaustively, including ties and single-ballot groups, with no database.
- Changing the formula is a TypeScript change with tests, not a migration.
- Counting stays in the database where it is fast and indexable.
- Identical numbers on web, in server rendering, and in any future client or service.

### Negative
- Results logic spans two places, so a reader must know that SQL counts and TypeScript decides.
- The full count set for a group crosses the wire from database to server before reduction — tiny
  here (at most 36 rows per group), but not free.

### Neutral
- If aggregation ever becomes hot, the view can become materialised without touching the formula.

## Alternatives Considered
- **All aggregation in SQL, including ordering and tie-breaks** — one round trip. Rejected because
  tie-break and rounding rules in SQL are painful to test and would drift from any second host.
- **All aggregation in TypeScript, fetching raw ballot entries** — one source of truth. Rejected:
  it transfers every entry row per request for no benefit.
- **Weighted 6..1 points as the headline percentage** — one tidy number per pair summing to 100%.
  Rejected because it reads as "share of people who think X" while meaning something else.
- **Condorcet/Kemeny aggregate ordering** — theoretically better crowd ordering. Rejected as
  disproportionate and unexplainable to the audience.

## References
- [data-model.md](../../specs/001-group-standings-voting/data-model.md) — Scoring definition
- [spec.md](../../specs/001-group-standings-voting/spec.md) — FR-016 – FR-019, SC-004
