# Feature Specification: Lineup Image Import

**Feature Branch**: `002-lineup-image-import`

**Created**: 2026-08-31

**Status**: Draft

**Input**: User description: "Lineup image import on the admin page. The organiser uploads a screenshot of the tournament ranking table (columns: Jogador 1, Jogador 2, PTS J1, PTS J2, Pontos Total, Clube). The system extracts the rows into an editable draft table on the admin page and prompts only for the fields the image cannot supply — tournament name and start date/time. Extraction is best-effort: rows that are unreadable or inconsistent (missing points, total not equal to the sum of the two players' points, odd number of rows) come back with the suspect cells flagged so the organiser corrects them inline. Nothing is published from extraction directly: the draft feeds the existing mandatory preview then publish flow, unchanged. Grouping stays as today — pairs ordered by total points descending, chunked into groups of six; the club column is informational only and does not define groups. Player identity still resolves by exact name against the published ranking sheet; the image supplies no external ids. The uploaded image is never stored or logged."

> **Numbering note**: requirements and criteria in this spec are numbered from 101 so they never
> collide with feature 001's FR-001…FR-026 and SC-001…SC-011, which are cited throughout the code.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Import a lineup from a screenshot (Priority: P1)

The organiser has the tournament lineup as a screenshot of a spreadsheet — the format it actually
arrives in, from a club chat or an exported sheet. It has one row per pair: both player names, each
player's ranking points, the pair's total points, and the club. It has no tournament name and no
start time, because the sheet never carries them.

They open the private organiser area, choose the image, and within a few seconds see every row from
the image laid out as an editable table, ordered by pair total points descending — the same order the
lineup will be grouped in. Two fields sit above the table, empty and required: the tournament name
and the start date and time. Nothing else is asked of them, because nothing else was missing.

They fill in the two fields, glance over the table, and continue into the existing preview step. From
there the flow is exactly what it is today: the preview must succeed before publishing is offered.

**Why this priority**: this is the whole feature. Today the same lineup is transcribed by hand into a
structured payload — twelve pairs, twenty-four names, thirty-six numbers — which is slow and is the
most likely source of a wrong lineup on a public page. Delivered alone, it removes that transcription
entirely.

**Independent Test**: upload a screenshot of a twelve-pair lineup, confirm all twelve rows appear
with both names, both point values, the total and the club, confirm the only empty required fields
are name and start time, and confirm the preview step accepts the result unchanged.

**Acceptance Scenarios**:

1. **Given** the organiser is signed in to the organiser area, **When** they upload a legible
   screenshot of a twelve-pair lineup table, **Then** a draft table appears containing twelve rows,
   each with two player names, two point values, a pair total and a club, ordered by pair total
   descending.
2. **Given** a draft table has been produced from an image, **When** the organiser looks at the form,
   **Then** exactly two fields are empty and marked required — tournament name and start date/time —
   and the organiser is not asked to supply anything the image already provided.
3. **Given** a complete draft table and both required fields filled, **When** the organiser requests
   the preview, **Then** the preview behaves exactly as it does for a hand-entered lineup, including
   refusing to publish when a player name cannot be matched against the published ranking list.
4. **Given** an image has been uploaded and a draft produced, **When** the organiser uploads a
   different image, **Then** the draft table is replaced by the new extraction and any previously
   obtained preview is retracted.

---

### User Story 2 - Correct what the image could not give (Priority: P2)

The screenshot is imperfect: a compressed image from a chat app, a name with an accent, two numeric
columns that sit close together. Some cells come back blank or obviously wrong, and one row's total
does not equal the sum of its two player point values.

The organiser sees those specific cells marked, with a short reason for each — the value is missing,
or the total does not match the two player values. They correct them in place, in the table, and
continue. Nothing about the correction requires them to understand or edit a structured payload.

**Why this priority**: extraction from an image cannot be assumed perfect, and an unmarked misread is
worse than no extraction at all — it looks correct and reaches the public page. Making suspect cells
visible is what makes the feature safe to use. It is P2 rather than P1 because a clean image already
delivers value without it.

**Independent Test**: upload an image where one row's points are unreadable and another row's total
disagrees with its two player values; confirm precisely those cells are marked with a stated reason,
that no other cell is marked, and that correcting them clears the marks.

**Acceptance Scenarios**:

1. **Given** an image where one player's points cannot be read, **When** extraction completes,
   **Then** that cell is empty and marked as missing, and the rest of the table is unaffected.
2. **Given** a row whose stated total does not equal the sum of its two player point values,
   **When** extraction completes, **Then** that row is marked with a mismatch reason, the value read
   from the image is kept rather than recomputed, and the organiser may proceed after reviewing it.
3. **Given** marked cells in the draft, **When** the organiser edits a marked cell to a valid value,
   **Then** the mark for that cell clears without re-uploading the image.
4. **Given** an image that yields an odd number of usable rows or no rows at all, **When** extraction
   completes, **Then** the organiser is told so plainly and may correct the draft by hand or upload a
   different image.
5. **Given** a draft with any cell still empty, **When** the organiser requests the preview, **Then**
   the preview is refused with the incomplete rows named.

---

### User Story 3 - Keep hand entry available (Priority: P3)

An organiser who already has the lineup as structured text, or who is working around a bad
extraction, can still enter the lineup the way they do today, without going through an image.

**Why this priority**: it protects the existing working path from being lost, and it is the fallback
when extraction is unavailable. It is P3 because it is preservation of current behaviour, not new
value.

**Independent Test**: with no image uploaded, complete a publish end to end using the existing
hand-entry path and confirm it behaves as before this feature.

**Acceptance Scenarios**:

1. **Given** the organiser area, **When** no image is uploaded, **Then** the existing hand-entry path
   remains available and unchanged.
2. **Given** extraction is unavailable or fails, **When** the organiser is told so, **Then** the
   hand-entry path is still offered and a publish can be completed through it.

---

### Edge Cases

- **Image too large or not an image**: an oversized file or an unsupported file type is refused
  before any extraction is attempted, with a message naming the limit and the accepted types.
- **Extraction unavailable**: when the extraction capability is not configured or the upstream
  service is unreachable or slow, the organiser is told that extraction is unavailable — distinctly
  from "the image could not be read" — and the hand-entry path stays available.
- **Nothing table-like in the image**: a photo with no lineup table yields no rows and an explicit
  "no rows found" message rather than an empty draft with no explanation.
- **Duplicate player across two rows**: extraction does not deduplicate; the existing preview reports
  the duplicate, as it does for a hand-entered lineup.
- **Row count not divisible by six**: grouping behaviour is unchanged from feature 001 — a short
  final group of three to five is allowed, anything smaller is rejected at preview.
- **Names that cannot be matched**: unchanged from feature 001 — the preview refuses and names them.
  Extraction never creates a player.
- **A club appearing in contiguous blocks**: club is informational; it does not influence grouping.
- **Reordering after edits**: if an edit changes a pair's total, the draft's displayed order is
  recalculated so what the organiser sees matches the order the lineup will be grouped in.
- **Leaving the page mid-draft**: the draft is not persisted; leaving discards it, and the organiser
  is warned before losing an unsaved draft.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-101**: The organiser area MUST accept an uploaded image of a lineup table and produce a draft
  lineup from it, without the organiser transcribing any of the image's contents by hand.
- **FR-102**: Extraction MUST read, per row, both player names, both players' points, the pair's
  total points, and the club, when those values are present and legible in the image.
- **FR-103**: The system MUST present the extracted rows as an editable table in which every value
  can be corrected, rows can be added and removed, and the two required fields the image cannot
  supply — tournament name and start date/time — are presented empty and marked required.
- **FR-104**: The system MUST NOT prompt the organiser for any value the image supplied, beyond the
  ability to edit it.
- **FR-105**: Extraction MUST be best-effort: a row that is partly unreadable MUST still appear, with
  the unreadable values empty rather than guessed, rather than causing the whole upload to fail.
- **FR-106**: The system MUST mark each suspect value with a stated reason, covering at minimum: a
  missing player name, a missing point value, a missing club, and a pair total that does not equal
  the sum of the two player point values.
- **FR-107**: The system MUST NOT silently repair extracted data — it MUST NOT recompute a mismatched
  total, invent a point value, or drop an unreadable row.
- **FR-108**: The system MUST report, distinctly from per-cell marks, when extraction produced no
  rows or an odd number of rows.
- **FR-109**: Editing a marked value to a valid one MUST clear that mark without re-uploading.
- **FR-110**: The system MUST refuse to proceed to preview while any required draft value is empty,
  naming the rows concerned.
- **FR-111**: A draft MUST reach publication only through the existing preview-then-publish flow;
  extraction MUST NOT create, modify or publish a tournament by itself.
- **FR-112**: All validation that governs publication MUST continue to be performed by the server on
  the submitted draft, exactly as for a hand-entered lineup; extracted data MUST be treated as
  organiser input with no additional trust.
- **FR-113**: Grouping MUST remain unchanged: pairs ordered by total points descending, chunked into
  groups of six with a short final group of three to five permitted. The club value MUST be
  informational and MUST NOT determine groups.
- **FR-114**: Player identity MUST continue to resolve by exact name against the published ranking
  list; extraction MUST NOT supply, guess, or bypass an external player identifier, and MUST NOT
  cause a player record to be created.
- **FR-115**: Uploading a new image MUST replace the current draft and retract any preview already
  obtained.
- **FR-116**: The upload MUST be available only to a signed-in organiser; no unauthenticated request
  may cause an extraction to run.
- **FR-117**: The system MUST refuse an upload above a stated size limit, or of an unsupported file
  type, before attempting extraction, and MUST say which limit or type was violated.
- **FR-118**: The uploaded image MUST NOT be stored, and MUST NOT be written to logs or any other
  durable record; it MUST exist only for the duration of the request that extracts from it.
- **FR-119**: The system MUST distinguish, in what it tells the organiser, between "extraction is
  unavailable", "the image could not be read", and "the image was read but some values are suspect".
- **FR-120**: The hand-entry path MUST remain available and unchanged, including when extraction is
  unavailable.
- **FR-121**: The draft MUST NOT be persisted server-side between requests; an abandoned draft leaves
  no trace, and the organiser MUST be warned before navigating away from an unsaved draft.

### Key Entities

- **Lineup image**: the organiser-supplied picture of a lineup table. Transient — read once,
  never stored. Has a file type and a size, both bounded.
- **Extracted row**: one candidate pair read from the image — two player names, two point values, a
  pair total, a club, its position in the image, and zero or more marks. A row is not a pair until
  it survives preview.
- **Mark**: a stated reason a specific value in an extracted row is suspect — missing, or a total
  inconsistent with its parts. Advisory to the organiser; never a publication decision by itself.
- **Draft lineup**: the editable working state — the extracted rows plus the tournament name and
  start date/time. Client-side only, discarded on leaving. Its only outlet is the existing preview.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-101**: For a legible screenshot of a twelve-pair lineup, the organiser reaches a complete,
  ready-to-preview draft in under two minutes, entering only the tournament name and start time.
- **SC-102**: The draft table appears within ten seconds of the organiser choosing an image, or the
  organiser is told extraction is unavailable within that same window.
- **SC-103**: For a legible screenshot, at least 95% of the values the image contains — names, point
  values, totals, clubs — are extracted correctly without correction.
- **SC-104**: Every value that is extracted incorrectly as blank or inconsistent is marked; the
  organiser never has to compare the draft against the image cell by cell to find what is wrong.
- **SC-105**: Zero tournaments are published without passing the existing preview step, measured as:
  no publication path exists that skips it.
- **SC-106**: The number of values the organiser types to publish a twelve-pair tournament falls from
  the full lineup — sixty or more values — to two.
- **SC-107**: No uploaded image is recoverable from the system after its request completes, verified
  by inspecting stored data and logs after an import.

## Assumptions

- The organiser is the only user of this feature; there is one organiser and the existing organiser
  sign-in gates it.
- The image is a screenshot or export of a tabular lineup with one pair per row, in the column shape
  described. Photographs of a screen, handwriting, and rotated or heavily skewed images are out of
  scope for v1 — they may work, but no accuracy is promised for them.
- Extraction is performed by a capability outside this product's own logic; it is expected to be
  imperfect, which is why every extracted value is editable and the preview step stays mandatory.
- The data in the image — player names, clubs, ranking points — is already public on the club's
  published ranking sheet, so sending an image out for extraction discloses nothing that is not
  already published. No other data may be sent this way.
- Extraction can be unavailable — unconfigured, rate-limited, or unreachable — and the product must
  remain fully usable when it is.
- The published ranking list remains the sole source of player identity, unchanged from feature 001.
- Volume is a handful of imports per month, so no caching, batching or queuing of extractions is
  needed.
- Portuguese (pt-PT) is the primary language for all new copy, with English as fallback, unchanged
  from feature 001.
