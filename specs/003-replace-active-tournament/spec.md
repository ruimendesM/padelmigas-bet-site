# Feature Specification: Replace Active Tournament

**Feature Branch**: `003-replace-active-tournament`

**Created**: 2026-09-30

**Status**: Implemented

**Input**: User description: "Replace an active tournament. The organiser can replace a published tournament whose voting is still open with a corrected lineup (e.g. pairs withdrew or changed). The previous tournament is marked "invalidated" but kept as history; a new tournament with fresh voting replaces it. Decisions: (1) A group is "unchanged" when the replacement has a group with the same label AND the exact same set of pairs (same two players per pair); points, seeds and club changes are ignored. Ballots on unchanged groups carry over to the replacement group, so those voters keep their vote and see results. (2) The replacement takes over the original public URL (slug); the invalidated one moves to a derived slug (e.g. <slug>-invalidado-1). (3) The invalidated tournament is hidden from active/landing listings, shown in history with an "Invalidado" badge, read-only results, and a link to its replacement. (4) Changed groups start with zero ballots; everyone including previous voters may vote fresh; no per-group notice. Only open (not yet started) published tournaments can be replaced; replacement goes through the same preview-then-confirm flow as publishing, and the preview shows which groups will keep their votes."

> **Numbering note**: requirements and criteria in this spec are numbered from 201 so they never
> collide with feature 001 (FR-001…FR-026, SC-001…SC-011) or feature 002 (FR-101…, SC-101…),
> which are cited throughout the code.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Replace a tournament whose lineup changed (Priority: P1)

A tournament is published and people are already voting. Then the lineup changes: a pair withdraws,
a player is swapped, a late entry is added. Today the organiser has no way to correct a published
tournament — publishing is one-way — so the public page keeps showing a lineup that is no longer
true, and every vote cast on the affected groups predicts standings for pairs that will not play.

The organiser opens the private organiser area and chooses to replace the tournament, picking it
from the tournaments whose voting is still open. They supply the corrected lineup exactly as they
would for a new tournament — pasted, or imported from a screenshot — and preview it. The preview
shows the corrected tournament as usual and, for every group, whether it **keeps its votes**
(unchanged, with the number of ballots that will carry over) or **restarts voting** (changed). The
organiser confirms, and the corrected tournament goes live at the original public address with
voting open.

**Why this priority**: this is the whole feature. Without it, a wrong lineup on a public page has no
fix short of editing the database by hand, which the constitution forbids.

**Independent Test**: publish a two-group tournament, cast ballots on both groups, replace it with a
lineup that changes one pair in group B only, and confirm that group A keeps its ballots and group B
starts from zero, all at the original address.

**Acceptance Scenarios**:

1. **Given** a published tournament with voting open, **When** the organiser starts a replacement,
   **Then** it is offered as a replaceable tournament; tournaments whose voting has closed, and
   tournaments already invalidated, are not offered.
2. **Given** a replacement lineup, **When** the organiser previews it, **Then** the preview lists
   every group of the replacement with either "keeps its votes" and the number of ballots that will
   carry over, or "voting restarts".
3. **Given** a replacement lineup that fails any rule a new lineup must satisfy (unknown player,
   malformed field, start time not in the future, duplicated player), **When** the organiser
   previews or confirms it, **Then** it is rejected exactly as a new lineup would be, and the
   original tournament is left untouched and still open.
4. **Given** a successful preview, **When** the organiser confirms, **Then** in one step the original
   tournament becomes invalidated and the replacement becomes publicly visible at the original
   address with voting open; there is never a moment when both, or neither, are live at that address.
5. **Given** a successful preview, **When** the original tournament's voting closes or it is replaced
   by someone else before the organiser confirms, **Then** confirming is refused and nothing changes.
6. **Given** an unauthenticated visitor, **When** they attempt to replace a tournament, **Then** the
   request is refused.

---

### User Story 2 - Keep votes on groups that did not change (Priority: P1)

A visitor voted on group A and group B of the original tournament. The replacement changed group B
only. When they come back, group A still shows their own ordering and the crowd results — they are
not asked to vote on it again. Group B shows a voting form, because the pairs they ranked are no
longer the pairs in that group.

**Why this priority**: carrying unchanged groups over is what makes replacing a tournament cheap for
the audience. Without it, one withdrawn pair would throw away every vote in the tournament.

**Independent Test**: after the replacement from Story 1, open the tournament as the voter who voted
on both groups, and confirm group A shows their ballot and results while group B shows a form; then
open it as a new visitor and confirm group A's ballot count includes the carried-over ballots.

**Acceptance Scenarios**:

1. **Given** a group in the replacement with the same label and the same set of pairs as a group of
   the original — each pair made of the same two players — **When** the replacement is published,
   **Then** every ballot cast on the original group counts towards the replacement group, and each
   voter's ranking of each pair is preserved.
2. **Given** a group whose pairs are the same but whose points, seeds, display order or club changed,
   **When** the replacement is published, **Then** the group is still treated as unchanged and keeps
   its votes.
3. **Given** a group whose label matches but whose pairs differ in any way (a pair added, removed,
   or with a different player), or a group whose pairs match a group with a different label,
   **When** the replacement is published, **Then** the group starts with zero ballots.
4. **Given** a voter whose ballot carried over, **When** they open the replacement, **Then** they see
   their own ordering and the crowd results for that group, and cannot vote on it again.
5. **Given** a voter who voted on a group that changed, **When** they open the replacement, **Then**
   they see a voting form for that group and may vote on it; nothing on the page refers to their
   discarded ballot.

---

### User Story 3 - See what was replaced (Priority: P2)

A visitor browsing past tournaments sees the invalidated tournament in the history list with an
"Invalidado" mark. Opening it shows the lineup and results as they stood when it was replaced,
read-only, with a link to the tournament that replaced it. The invalidated tournament never appears
among the tournaments open for voting.

**Why this priority**: it keeps the record honest — the club can see that a lineup was corrected and
what it was before — but the product is correct without it.

**Independent Test**: after a replacement, confirm the landing page lists only the replacement, the
history lists the invalidated tournament with its mark and a working link to the replacement, and
its page offers no voting form.

**Acceptance Scenarios**:

1. **Given** an invalidated tournament, **When** a visitor opens the list of tournaments open for
   voting, **Then** it is not listed, even though its start time has not passed.
2. **Given** an invalidated tournament, **When** a visitor opens the history view, **Then** it is
   listed with an "Invalidado" mark and a link to its replacement.
3. **Given** an invalidated tournament, **When** a visitor opens it, **Then** its groups and pairs
   are shown as they were, no voting form appears, a ballot submitted against it is refused as
   closed, and a link leads to the replacement.
4. **Given** an invalidated tournament whose replacement is still open for voting, **When** a visitor
   opens it, **Then** crowd results are withheld with a note that they become available once voting
   on the replacement closes; once the replacement's voting closes, the results as they stood at
   invalidation are shown to everyone.
5. **Given** a player who appeared in an invalidated tournament, **When** a visitor opens that
   player, **Then** the invalidated tournament is not listed among their appearances; the
   replacement is, if the player is in it.

---

### Edge Cases

- The replacement is itself replaced before voting closes → allowed; it becomes invalidated in turn,
  carry-over is judged against it (the latest version), and each invalidated version gets its own
  distinct address. Ballots carried into it carry on again if their group is still unchanged.
- The replacement has a different name or start time → allowed; only the lineup's groups are
  compared for carry-over. A later start time extends voting for the carried-over groups too.
- The replacement has more or fewer groups than the original → groups with no counterpart start
  from zero; original groups with no counterpart simply end with the invalidated tournament.
- Pairs moved between groups so that group B of the original is now group C → treated as changed
  (label must match), voting restarts.
- The two players of a pair are listed in the opposite order in the replacement → same pair.
- A voter voted on the original but their cookie was since cleared → their ballot still carries over
  and still counts; they are treated as a new voter, as today.
- A ballot on the original is being submitted at the instant the replacement is confirmed → either it
  lands before the replacement and is carried over (if its group is unchanged), or it is refused as
  closed; it is never lost silently while reported as recorded.
- A replacement lineup identical to the original in every group → allowed; all groups keep their
  votes. The organiser is not blocked from a no-op correction (e.g. only the start time changed).
- The original address was already shared on social media → it now opens the replacement.

## Requirements *(mandatory)*

### Functional Requirements

**Replacing**

- **FR-201**: The system MUST allow an authorised organiser to replace a published tournament whose
  voting is open and which has not already been invalidated, by supplying a complete new lineup in
  the same form accepted for publishing a new tournament.
- **FR-202**: A replacement lineup MUST be validated by every rule that applies to a new lineup
  (feature 001 FR-001…FR-007), and a rejected replacement MUST leave the original tournament
  unchanged and open.
- **FR-203**: The system MUST preview a replacement before it can be confirmed, and the preview MUST
  show, per group of the replacement, whether it keeps its votes and how many ballots carry over, or
  that voting restarts. An explicit confirmation MUST be required, as for publishing.
- **FR-204**: On confirmation the system MUST, as one indivisible change, mark the original tournament
  invalidated, publish the replacement, and carry over the ballots of unchanged groups. If any part
  fails, nothing changes.
- **FR-205**: The system MUST refuse a confirmation when, at the moment of confirming, the original's
  voting has closed or it has already been invalidated.

**Carry-over**

- **FR-206**: A replacement group MUST be treated as unchanged when the original has a group with the
  same label whose set of pairs is identical, a pair being identified by its two players regardless
  of their order. Points, seeds, display order, and club MUST NOT affect this judgement.
- **FR-207**: Every ballot on an unchanged original group MUST count towards the replacement group
  with the same voter and the same position for each pair, and MUST keep counting towards the
  original group in the invalidated tournament's frozen results.
- **FR-208**: A voter whose ballot carried over MUST be treated in the replacement as having voted on
  that group — own ordering shown, results revealed, no second ballot accepted.
- **FR-209**: A changed group MUST start with zero ballots, and any visitor, including one who voted
  on the original group, MUST be able to vote on it.

**Invalidated tournaments**

- **FR-210**: The replacement MUST take over the original's public address. The invalidated
  tournament MUST move to a distinct, stable address derived from the original, unique even when a
  tournament is replaced more than once.
- **FR-211**: An invalidated tournament MUST accept no ballots and MUST NOT appear among tournaments
  open for voting.
- **FR-212**: An invalidated tournament MUST be retained with its groups, pairs, and ballots, and MUST
  appear in the history view marked "Invalidado", with a link to the tournament that replaced it;
  its own page MUST show the same mark and link.
- **FR-213**: An invalidated tournament's crowd results MUST be withheld from everyone while the
  tournament that replaced it (directly or through further replacements) still has voting open, and
  MUST be public once that voting closes, frozen as they stood at invalidation.
- **FR-214**: A player's appearance history MUST NOT list invalidated tournaments.

### Key Entities

- **Tournament**: gains an invalidated state — when it was invalidated and which tournament replaced
  it. An invalidated tournament is never live and never votable.
- **Replacement link**: from an invalidated tournament to the one that replaced it; following links
  from any invalidated tournament always reaches exactly one live (not invalidated) tournament.
- **Carried-over ballot**: a voter's ballot on a replacement group that originated from their ballot on
  the unchanged original group; same voter, same positions per pair.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-201**: An organiser can go from "a pair withdrew" to a corrected tournament live at the same
  address in under 3 minutes, without touching the database.
- **SC-202**: After a replacement changing one group of a two-group tournament, 100% of ballots on
  the unchanged group count in the replacement, and 0 ballots appear on the changed group.
- **SC-203**: The ballot count and per-position percentages of every unchanged group are identical
  immediately before and immediately after the replacement.
- **SC-204**: 0 ballots are accepted against an invalidated tournament.
- **SC-205**: No public view reveals an invalidated tournament's crowd results while its replacement's
  voting is open (preserves feature 001's vote-to-reveal guarantee, SC-006).
- **SC-206**: The original public address never returns "not found" during or after a replacement.

## Assumptions

- "Division" in the club's vocabulary is a group of the tournament; the terms are used
  interchangeably.
- Replacing is only for tournaments still open for voting. A tournament whose start time has passed
  is history and is not corrected through this feature.
- The replacement is a complete lineup, not a diff; the organiser re-supplies everything, using the
  existing paste or screenshot import.
- There is no reason text for a replacement; the invalidated mark and link are the whole record.
- Freezing the invalidated tournament's results and hiding them until the replacement closes is
  chosen so a visitor cannot read a carried-over group's crowd prediction without voting.
- Players are excluded from appearance history for invalidated tournaments so a corrected lineup
  does not show the same event twice.
- An invalidated tournament cannot be restored; if the correction was wrong, the organiser replaces
  the replacement.
