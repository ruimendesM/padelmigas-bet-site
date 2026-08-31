# Phase 1 Data Model: Lineup Image Import

**No database change.** This feature adds no table, no column, no index and no migration. Everything
below is in-flight data: it exists inside one request, or inside the browser tab, and is gone
afterwards (FR-118, FR-121, SC-107).

## Types

### `LineupImage` — the upload (contracts)

| Field | Type | Rules |
|---|---|---|
| `mimeType` | `'image/png' \| 'image/jpeg' \| 'image/webp'` | Anything else → `PAYLOAD_TOO_LARGE` with an issue naming the accepted types (FR-117) |
| `dataBase64` | `string` | Base64, no data-URL prefix. Decoded size ≤ 5 MB (5 242 880 bytes); the base64 length is checked before decoding so an oversized body is rejected without allocating it |

Never stored, never logged, never included in an error message. Held only for the duration of the
request (FR-118).

### `RawExtractedRow` — what the reader returns (core port)

The provider's output, mapped to domain shape and nothing more. Every field is nullable because the
reader is forbidden from inventing values (research D9).

| Field | Type | Meaning |
|---|---|---|
| `sourceIndex` | `number` | 0-based position in the image, top to bottom. Preserved so an issue can point back at what was uploaded |
| `player1Name` | `string \| null` | As read; not translated, not case-corrected |
| `player1Points` | `number \| null` | As read |
| `player2Name` | `string \| null` | |
| `player2Points` | `number \| null` | |
| `totalPoints` | `number \| null` | As read from the total column — never computed from the two player values |
| `club` | `string \| null` | Informational only; never determines groups (FR-113) |

### `ExtractedRow` — one normalised candidate pair (core → contracts DTO)

`normalizeExtraction` produces these: trimmed and NFC-normalised names, whitespace collapsed,
non-finite or negative numbers reduced to `null`, rows ordered by `totalPoints` descending with rows
lacking a total placed last, `sourceIndex` preserved through the sort.

| Field | Type | Notes |
|---|---|---|
| `sourceIndex` | `number` | From the raw row |
| `players` | `[{ name: string \| null, points: number \| null }, { … }]` | Exactly two, order as read |
| `totalPoints` | `number \| null` | As read |
| `club` | `string \| null` | |
| `flags` | `Flag[]` | Possibly empty; see below |

### `Flag` — a stated reason a value is suspect

| Flag | Raised when | Cleared by |
|---|---|---|
| `MISSING_NAME` | Either player name is `null` or empty after trimming | Typing a name |
| `MISSING_POINTS` | Either player's points is `null` | Typing a number |
| `MISSING_CLUB` | Club is `null` or empty after trimming | Typing a club |
| `TOTAL_MISMATCH` | All three of the two player point values and the total are present, and `total ≠ p1 + p2` | Editing any of the three so they agree — or accepting it, since this flag never blocks |

Flags are advisory. They mark cells for the organiser (FR-106); they are never a publication decision
(FR-111, FR-112). `TOTAL_MISMATCH` alone does not prevent proceeding to preview; every other flag
does, because it means a required value is empty (FR-110).

Flag derivation is total and deterministic: given the same normalised row, the same flags. It is the
part of the module the 100%-branch requirement covers.

### `LineupExtraction` — the endpoint's response

| Field | Type | Notes |
|---|---|---|
| `rows` | `ExtractedRow[]` | Possibly empty |
| `warnings` | `Warning[]` | Row-set level, distinct from per-cell flags (FR-108) |

| Warning | Raised when |
|---|---|
| `NO_ROWS_FOUND` | `rows` is empty |
| `ODD_ROW_COUNT` | `rows.length` is odd — a lineup is pairs, so an odd count means a row was lost or invented |

### `LineupDraft` — the browser's working state (`packages/ui-logic`)

Client-side only; never sent as-is and never persisted (FR-121, research D8).

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | Empty on arrival; required (FR-103) |
| `startsAtLocal` | `string` | `Europe/Lisbon` local date-time from the input; converted to a UTC instant on serialisation |
| `rows` | `ExtractedRow[]` | Editable; rows may be added and removed |

Transitions, all pure functions:

- `editCell(draft, sourceIndex, field, value)` → re-derives that row's flags, so a corrected value
  clears its flag with no re-upload (FR-109), and re-sorts by total descending when a total changed,
  so the displayed order matches the order the lineup will be grouped in.
- `addRow(draft)` / `removeRow(draft, sourceIndex)` → an added row is fully empty and therefore fully
  flagged.
- `isComplete(draft)` → false while any name, points value, club, total, the name, or the start time
  is empty. `TOTAL_MISMATCH` does not make a draft incomplete.
- `toLineupPayload(draft)` → the **existing** `lineupPayload` shape from feature 001, unchanged: no
  `group` labels (grouping stays derived, FR-113), no `slug` (derived), no external ids (FR-114),
  `startsAt` as a UTC ISO instant.

## Relationships to the existing model

```
LineupImage ──read──> RawExtractedRow[] ──normalize──> ExtractedRow[] ──edit──> LineupDraft
                                                                                    │
                                                                    toLineupPayload │
                                                                                    ▼
                                              (unchanged from feature 001)   lineupPayload
                                                                                    │
                                                                        preview ────┴──── publish
```

Everything to the right of `lineupPayload` is untouched by this feature. `deriveLineup` still orders
pairs by total points descending and chunks them into groups of six with a short final group of 3–5
(FR-113); `resolvePlayers` still matches names exactly against the ranking list and fails loudly on
an unmatched or ambiguous name (FR-114). No player is created by extraction, ever.

## What deliberately has no persistent representation

- The uploaded image (FR-118).
- The extraction result (it is a response, not a record).
- The draft (FR-121).
- Any per-provider metadata — no token counts, no request ids, no provider response stored. Nothing
  about the call survives it.
