# Data Model: Replace Active Tournament

Migration `0007_tournament_replacement.sql`, additive.

## tournaments (changed)

| Column | Type | Notes |
|---|---|---|
| `invalidated_at` | `timestamptz null` | Set once, when replaced. Never cleared (no restore). |
| `replaced_by_id` | `uuid null references tournaments(id)` | The direct replacement. |

Constraints:

- `tournaments_invalidation_complete`: `(invalidated_at is null) = (replaced_by_id is null)`.
- `tournaments_not_self_replaced`: `replaced_by_id <> id`.
- The existing `tournaments_published_before_start` check is unaffected.

Derived state (never stored), decided by `core/window`:

```text
draft ──publish──▶ open ──starts_at passes──▶ closed
                    │
                    └──replace──▶ invalidated (reported as closed on the wire)
```

Live successor: follow `replaced_by_id` until a row with `invalidated_at is null`. Only open
tournaments can be replaced and a replacement is always open at birth, so the chain ends in exactly
one live tournament.

## ballots (changed)

| Column | Type | Notes |
|---|---|---|
| `carried_from_id` | `uuid null references ballots(id)` | Set on ballots copied into a replacement group. |

The copy keeps `voter_id` and `cast_at`. `UNIQUE (group_id, voter_id)` still holds: a voter has at
most one ballot on the original group, so at most one copy.

## Carry-over plan (core, not stored)

`planCarryOver(original, replacementGroups)` → per replacement group:

- `label`
- `carriedFrom`: `{ groupId, pairMap: [{ fromPairId, toSeed }] } | null`

`toSeed` identifies the replacement pair within its group, since replacement pair ids only exist
after insert.

## Rollback

```sql
alter table ballots drop column if exists carried_from_id;
alter table tournaments drop constraint if exists tournaments_not_self_replaced;
alter table tournaments drop constraint if exists tournaments_invalidation_complete;
alter table tournaments drop column if exists replaced_by_id;
alter table tournaments drop column if exists invalidated_at;
```

Lossy after use: rolling back after a replacement leaves two tournaments visible as live, one at the
derived slug. Delete or re-slug by hand before rolling back.
