# ADR-007: Ranking-Sheet ID as Canonical Player Identity, Normalised Exact-Name Matching

## Status
Accepted — 2026-08-27. **Amended 2026-08-28**: the canonical identity moves from the sheet's `ID` to
the normalised name. See "Amendment" below; the matching rules themselves are unchanged.

## Context
Players must be stored individually and once, so that tournament history can be derived per player
rather than duplicated. Lineups arrive as names and points, with no identifiers. The club publishes a
ranking spreadsheet that has both a stable numeric `ID` and a name per player, and it is exportable as
CSV without credentials. Empirical check on 2026-08-27: 783 rows, zero duplicate names, and 23 of the
24 names in a real lineup matched byte-for-byte — the single miss differed only in the
capitalisation of a name particle (lower-case in the lineup, upper-case on the sheet). All 24 match
after case folding.

## Decision
Treat the ranking sheet's `ID` as the canonical `external_id` of a player. Resolve a lineup name to a
player by comparing a `match_key` computed as Unicode NFC normalisation → case folding → whitespace
collapsing. No fuzzy, phonetic, or nickname matching. A payload entry may carry an explicit
`externalId`, which wins over name matching and is the required disambiguation when two real people
share a name. Every sync re-checks the source for colliding match keys and aborts the whole import if
one exists. An unresolved name blocks the entire publish with the offending entries named; the system
never creates a player under a guessed identity. Rating snapshots from the sheet's dated columns
populate `player_ratings`, and a tournament captures each player's points at publish time so the
displayed figures never change retroactively.

## Consequences

### Positive
- One row per real person across tournaments, so a player's history is a query (FR-025, SC-008).
- Identity is owned by the club's existing ranking process rather than invented by this app.
- Case, accent composition, and stray whitespace stop being a source of duplicate players.
- Loud failure on anything ambiguous, which is the correct bias for identity data.
- The dated rating columns give a free points history with no extra data entry.

### Negative
- A player who is not yet on the ranking sheet cannot be published until the sheet is updated or an
  explicit `externalId` is supplied — friction by design, and it will happen with a new member.
- Name uniqueness is a property of today's data, not a guarantee; the collision check must run
  forever, and a future collision requires payloads to carry ids for those entries.
- A renamed player on the sheet creates a new `match_key`; reconciling that is a manual step.
- The sheet's dated column headers are inconsistently formatted (`26/08/2026` and `22-08-2026` both
  occur), so parsing must be tolerant rather than assume a format.

### Neutral
- The importer keeps the raw CSV snapshot, which doubles as an audit trail and a stale-source
  fallback.

## Alternatives Considered
- **Fuzzy/trigram matching with a confidence threshold** — fewer import failures. Rejected: a wrong
  automatic merge corrupts player history silently, which is far worse than a blocked publish.
- **Hand-maintained id list in the repository** — exact and reviewable. Rejected as duplicated work
  when an authoritative published list already exists.
- **Auto-match with an admin merge UI** — most robust over years. Deferred, not rejected: it is the
  right answer once name collisions or renames actually appear, and nothing here blocks adding it.
- **Creating a local player on first sight of an unknown name** — smoothest import. Rejected: it
  guarantees duplicate people within a season.

## Amendment — 2026-08-28: normalised name becomes the canonical identity

### What changed
`external_id` is no longer the canonical identity and no longer unique. The `match_key` — the
normalised name this ADR already defined — becomes the identity a player is stored and resolved
under. `external_id` is retained as nullable, non-unique, informational metadata.

Nothing else in this ADR changes. The matching rule (NFC → case fold → collapse whitespace), the
refusal to fuzzy match, the abort-on-colliding-match-key check, and the refusal to invent a player
under a guessed identity all stand exactly as written.

### Why
The original decision rested on a premise that turned out to be false: that the sheet's `ID` was a
stable unique identifier. Verified against the live export on 2026-08-28 — 784 rows, 756 distinct
identifiers, 18 identifiers shared by 46 rows describing different people, and 784 distinct
normalised names with zero collisions. The identifiers run 1..784 with exactly 28 unused slots and
exactly 28 surplus rows, so the sheet was intended to be unique and 28 assignments collided.

Two facts make this unfixable at the source rather than a data-entry problem to report upstream:

1. **The sheet is maintained by a third party.** The club cannot correct the 28 rows, and cannot stop
   the next collision when a new member is added.
2. **While the identifier is required to be unique, every import aborts.** The system is not
   degraded, it is stopped — no players, no ratings, no publish.

Rating history lives in the row rather than being keyed by the identifier, so demoting it loses
nothing that the source itself relies on.

### Consequences of the amendment

**Positive**
- Imports work against the sheet as it actually is, not as it was assumed to be.
- The identity key is now the only field in the source that has ever been unique.
- Collision handling gets simpler: one guard on one key, rather than two keys that can disagree.

**Negative**
- **A rename on the sheet now splits a player in two.** Accents are deliberately preserved by the
  normaliser, so a correction from `Joao` to `João` produces a different key: the history orphans and
  a duplicate person appears. Previously a rename was recoverable because the identifier held the
  person together. Nothing detects this automatically.
- The explicit `externalId` disambiguation escape hatch is gone, because the field it relied on is
  not unique. Two people who genuinely share a normalised name can no longer be told apart at all —
  the import aborts and there is no payload-level override.
- The club now depends on a third party never introducing a duplicate name. It has not happened in
  784 rows, but the failure mode is a hard stop that the club cannot clear on its own.

**Neutral**
- The "auto-match with an admin merge UI" alternative below moves from *deferred* to *the eventual
  answer to name drift*. It is the mitigation for both negatives above and should be specified as
  soon as either one actually bites.

## References
- [research.md](../../specs/001-group-standings-voting/research.md) — F1, F2 (F2 amended 2026-08-28)
- [spec.md](../../specs/001-group-standings-voting/spec.md) — FR-004 (amended), FR-005, FR-007, FR-008
- [data-model.md](../../specs/001-group-standings-voting/data-model.md) — `players` (amended)
