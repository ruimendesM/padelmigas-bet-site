# Research: Replace Active Tournament

## R1 — Carry ballots over by copying, not by reference

- **Decision**: on confirmation, insert a new `ballots` row in the replacement group for every
  ballot on the unchanged original group (same `voter_id`, same `cast_at`, `carried_from_id` set),
  plus its entries with pair ids mapped to the replacement's pairs.
- **Rationale**: `group_position_counts`, `group_ballot_counts`, `findOwn`, `votedGroupIds`, and the
  `UNIQUE (group_id, voter_id)` constraint then work untouched. The original's ballots stay where
  they are, which is exactly the frozen history FR-207 asks for.
- **Alternatives**: (a) re-point ballots to the new group — destroys the invalidated record;
  (b) a "group lineage" column with counts unioned across versions — touches every read query and
  the one-ballot constraint, for no user-visible gain.

## R2 — Invalidated is "closed" on the wire

- **Decision**: `core/window` returns `closed` for an invalidated tournament. The wire enum stays
  `open | closed`; an additive `invalidation` object on the summary carries the mark, the
  replacement link, and whether results are withheld.
- **Rationale**: one place decides votability (Risk R5), and a new enum value would be a semantic
  change for existing clients (Principle III). Every ballot path already refuses `closed`.

## R3 — Reveal gate for invalidated tournaments

- **Decision**: `isRevealed` gains an optional `liveSuccessor`. For an invalidated tournament it
  returns true only when the live successor (end of the replacement chain) is closed; with no
  successor supplied it fails closed.
- **Rationale**: FR-213 — carried groups are still votable in the replacement, so the old results
  are a peek-without-voting path. Keeping the rule inside `core/reveal` keeps one auditable gate.

## R4 — No ballot lost at the moment of replacement

- **Decision**: `replace()` takes `SELECT … FOR UPDATE` on the original tournament row; the ballot
  insert takes `FOR SHARE` on its group's tournament row and re-checks `invalidated_at is null` and
  `starts_at > now`, returning a new `closed` outcome otherwise.
- **Rationale**: without it, a ballot validated before the replacement but committed after the copy
  would be stored on the invalidated group only and reported as recorded — the edge case the spec
  names. The share lock serialises exactly that race and costs nothing in the common case
  (concurrent voters share the lock).
- **Alternatives**: SERIALIZABLE isolation for both paths — heavier, needs retry handling.

## R5 — Derived slug for the invalidated tournament

- **Decision**: `<slug>-invalidado-<n>`, `n` = 1 + number of existing tournaments whose slug
  starts with `<slug>-invalidado-`, computed inside the transaction; truncate the base so the result
  stays ≤ 120 characters.
- **Rationale**: stable, readable, unique across repeated replacements (FR-210). The replacement
  always takes the original slug; a `slug` in the replacement payload is ignored.

## R6 — Pair identity

- **Decision**: a pair is the unordered pair of player ids. A group is unchanged when a group with the
  same label exists in the original and both pair sets are equal (same size, same members).
- **Rationale**: spec FR-206 as decided by the organiser. Player ids are stable because players
  resolve by normalised name (ADR-007).

## R7 — Listing

- **Decision**: add `includeInvalidated` (default `false`) to the list query. Landing (`all`) keeps
  the default and so hides invalidated tournaments; history (`closed`) passes `true`.
- **Rationale**: additive query parameter; the default preserves today's meaning for "live"
  listings.
