# Feature Specification: Group Standings Voting

**Feature Branch**: `001-group-standings-voting`

**Created**: 2026-08-27

**Status**: Draft

**Input**: User description: "Upload a padel tournament lineup (pairs grouped in groups of six by ranking), let visitors vote on how they think each group will finish (1st to 6th), and show the crowd's predicted standings as percentages. Keep a history of past tournaments and store each player individually."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publish a tournament lineup (Priority: P1)

The organiser has the lineup for an upcoming tournament: an ordered list of pairs with each player's
ranking points, their club, and the pair's total points. They open the private organiser area, paste
the lineup as a structured data payload, and see a preview showing the tournament name, its start
time, and each group with its six pairs and the two named players per pair. Every player name is
matched against the club's published ranking list so the same person is recognised across
tournaments. If any name cannot be matched, the preview refuses to publish and names exactly which
entries are unknown. When the preview looks right, the organiser publishes, and the tournament
becomes visible on the public site with voting open.

**Why this priority**: nothing else in the product can exist without a published lineup. It is also
the only step that must be correct before an audience sees anything.

**Independent Test**: paste a known 12-pair lineup, confirm the preview groups it into two groups of
six in ranking order, publish it, and confirm it appears publicly with voting open and with each
player linked to their ranking-list identity.

**Acceptance Scenarios**:

1. **Given** a valid lineup payload with 12 pairs and a future start time, **When** the organiser
   previews it, **Then** the system shows 2 groups of 6 pairs ordered by pair total points
   descending, with all 24 players resolved to known ranking-list identities.
2. **Given** a lineup payload containing a player name that is not on the ranking list, **When** the
   organiser previews it, **Then** publishing is blocked and the response lists each unmatched name
   with the pair it belongs to.
3. **Given** a lineup payload whose player names differ from the ranking list only by letter case,
   accents in composed/decomposed form, or surrounding whitespace, **When** the organiser previews
   it, **Then** those names resolve to the correct existing players and no duplicate player is
   created.
4. **Given** a published tournament, **When** the organiser publishes a second tournament containing
   players who already exist, **Then** no duplicate player records are created and each player's
   tournament history now lists both tournaments.
5. **Given** a lineup payload that is malformed, incomplete, or whose start time is in the past,
   **When** the organiser submits it, **Then** the system rejects it with a message naming the
   offending field and nothing is published.
6. **Given** an unauthenticated visitor, **When** they attempt to reach the organiser area or submit
   a lineup, **Then** the request is refused.

---

### User Story 2 - Vote on a group's final standings (Priority: P1)

A visitor opens a published tournament and sees its groups. For a group, they see the six pairs with
both player names, club, and ranking points. They assign each pair a distinct finishing position
from 1st to 6th, submit, and immediately see the crowd's current prediction for that group. They
cannot vote on the same group twice, and they can vote on the other groups independently.

**Why this priority**: this is the product. It is testable the moment a lineup exists and delivers
the whole user-facing value on its own.

**Independent Test**: on a published tournament with voting open, submit a complete ordering for one
group, confirm the results view replaces the voting form for that group only, and confirm a second
submission for that group is refused.

**Acceptance Scenarios**:

1. **Given** a group with voting open and a visitor who has not voted on it, **When** they open the
   tournament, **Then** they see a voting form for that group and no crowd percentages for it.
2. **Given** a completed ordering that uses each position exactly once, **When** the visitor
   submits, **Then** the ballot is recorded and the crowd results for that group are shown in place
   of the form.
3. **Given** an ordering that repeats a position or leaves one unassigned, **When** the visitor
   submits, **Then** the ballot is refused with an explanation and no partial ballot is stored.
4. **Given** a visitor who already voted on a group, **When** they return to that group, **Then**
   they see the crowd results and their own submitted ordering, and no way to vote again.
5. **Given** a visitor who voted on group A only, **When** they view group B, **Then** group B still
   shows a voting form and group B's percentages remain hidden.
6. **Given** the tournament's start time has passed, **When** a visitor submits a ballot, **Then**
   it is refused as closed and the crowd results are shown instead.
7. **Given** the same visitor's browser, **When** they return later within the voting window,
   **Then** the system still recognises them as having voted on the groups they already voted on.

---

### User Story 3 - See the crowd's predicted standings (Priority: P1)

Having voted (or after voting has closed), a visitor sees, for each group, the crowd's predicted
finishing order and, for every pair, the share of voters who placed that pair in each position — for
example "Bastos / Trindade — 1st: 62%". The number of ballots the percentages are based on is always
shown.

**Why this priority**: the percentages are the payoff that makes voting worth doing; without them
the vote is a dead end.

**Independent Test**: record a known set of ballots for one group, then confirm the displayed
per-position percentages and predicted order match the values computed by hand from those ballots.

**Acceptance Scenarios**:

1. **Given** 10 ballots on a group where 6 placed a given pair 1st, **When** results are shown,
   **Then** that pair shows 60% for 1st position and the total ballot count shows 10.
2. **Given** any group with at least one ballot, **When** results are shown, **Then** the crowd's
   predicted standings list all pairs in the group exactly once, ordered by best average predicted
   position.
3. **Given** two pairs with an identical average predicted position, **When** results are shown,
   **Then** the tie is broken deterministically and repeated views produce the same order.
4. **Given** a group with zero ballots and voting closed, **When** results are shown, **Then** the
   view states that no votes were cast rather than showing empty or zero percentages.
5. **Given** results for any group, **When** they are displayed, **Then** no individual voter's
   ballot is identifiable from anything shown.

---

### User Story 4 - Browse past tournaments and players (Priority: P2)

A visitor opens a history view listing past tournaments newest first. Opening one shows its groups,
its final crowd predictions, and the ballot counts. Opening a player shows the tournaments that
player has appeared in and the pairs they played in.

**Why this priority**: it makes the site worth returning to and is the visible proof that history is
being stored properly, but the product is usable without it.

**Independent Test**: publish two tournaments whose lineups share at least one player, let voting
close on the first, and confirm the history list, the archived results, and the player's
cross-tournament appearances are all correct.

**Acceptance Scenarios**:

1. **Given** at least one tournament whose voting has closed, **When** a visitor opens the history
   view, **Then** past tournaments are listed newest first with their names and dates.
2. **Given** a past tournament, **When** a visitor opens it, **Then** its groups, final crowd
   predictions, and ballot counts are shown and no voting form appears.
3. **Given** a player who appeared in two tournaments, **When** a visitor opens that player,
   **Then** both appearances are listed with the partner and group for each.

---

### Edge Cases

- A pair's two players are the same person, or a player appears in two pairs of the same tournament
  → rejected at preview with the conflicting entry named.
- Two different real people share exactly the same name on the ranking list → cannot be
  distinguished by name; the payload must carry the explicit ranking-list identifier for those
  entries. (No such duplicate exists in the current ranking list; the check must still run on every
  import and fail loudly if one appears.)
- A group has fewer than six pairs (e.g. an 11-pair lineup) → the group is voted as an ordering of
  however many pairs it contains, and percentages are computed over that size.
- A lineup has fewer pairs than one full group, or zero pairs → rejected.
- Voting closes while a visitor has the form open and unsubmitted → submission is refused as closed,
  the entered ordering is not lost from view, and results are shown.
- The same visitor votes from two different browsers or a private window → counted as two voters;
  accepted and documented, not prevented.
- A visitor's cookie is cleared after voting → they are treated as a new voter and may vote again;
  their earlier ballot remains counted and is not shown back to them.
- The published ranking list is unreachable when an import is attempted → the import proceeds using
  the last successfully stored ranking data, and the organiser is told the data may be stale.
- A player's ranking points change between tournaments → the points shown for a tournament are the
  ones captured when that tournament was published and do not change retroactively.
- Two ballots for the same group arrive from the same voter at the same instant → exactly one is
  recorded.
- A tournament is published with a start time only minutes away → voting is open for that short
  window and closes exactly at the start time.

## Requirements *(mandatory)*

### Functional Requirements

**Lineup publishing**

- **FR-001**: The system MUST allow an authorised organiser to submit a tournament lineup as a
  structured data payload containing the tournament name, its start instant, and an ordered list of
  pairs; each pair MUST carry both players' names, each player's ranking points, the pair's club, and
  the pair's total points.
- **FR-002**: The system MUST present a preview of a submitted payload — tournament name, start
  instant, groups, pairs, players, and resolved player identities — and MUST require an explicit
  publish action before anything becomes publicly visible.
- **FR-003**: The system MUST assign pairs to groups of six in descending order of pair total points,
  permitting a single smaller final group of three to five pairs when the lineup does not divide
  evenly, and MUST accept an explicit group assignment in the payload that overrides the derived one.
- **FR-004**: The system MUST resolve every player in a payload to a single stored player identity,
  matching on the player's name compared after Unicode normalisation, case folding, and whitespace
  collapsing, and MUST use the ranking list's own identifier as that player's canonical external
  identifier.
- **FR-005**: The system MUST reject an entire payload, publishing nothing, when any player cannot be
  resolved, when a required field is missing or malformed, when the start instant is not in the
  future, when a position or pair is duplicated, or when a player appears more than once, and MUST
  report every offending entry rather than only the first.
- **FR-006**: The system MUST restrict lineup submission and publishing to an authorised organiser
  and MUST refuse these operations for everyone else.
- **FR-007**: The system MUST record, per tournament, the ranking points captured at publish time,
  and MUST NOT alter them when the source ranking data later changes.
- **FR-008**: The system MUST store every player as an individual record and MUST represent a pair as
  a reference to two player records, so that a player's appearances across tournaments are derivable
  without duplicating player data.

**Voting**

- **FR-009**: The system MUST let any visitor cast a ballot without creating an account, signing in,
  or supplying any personal data. A ballot is a complete assignment of distinct finishing positions
  to every pair in one group. (Uniqueness per voter is specified in FR-013.)
- **FR-010**: The system MUST reject a ballot that is incomplete, that repeats a position, that names
  a pair outside the group, or that omits a pair in the group, and MUST store nothing in that case.
- **FR-011**: The system MUST accept ballots only while the tournament's voting window is open — from
  publication until the tournament's start instant — and MUST refuse them once closed, deciding open
  or closed on the server rather than trusting the client.
- **FR-012**: The system MUST recognise a returning visitor's device across sessions for the purpose
  of enforcing one ballot per group, and MUST count a cleared identifier or a private session as a
  new voter without failing.
- **FR-013**: The system MUST record exactly one ballot per voter per group even under concurrent or
  repeated submissions, and MUST refuse any further ballot for a group the voter has already voted on.
- **FR-014**: The system MUST show a visitor their own submitted ordering for any group they have
  voted on.
- **FR-015**: The system MUST treat each group independently: voting on one group MUST NOT affect the
  visitor's ability to vote on, or their view of, any other group.

**Results**

- **FR-016**: The system MUST compute, for every pair in a group, the share of that group's ballots
  placing that pair in each position, expressed as a percentage of the group's total ballots.
- **FR-017**: The system MUST compute a single crowd predicted standings order per group, listing
  every pair exactly once, ordered by the pair's average predicted position (best first).
- **FR-018**: The system MUST break ties in the predicted order deterministically — by count of
  first-place votes, then by higher pair total points, then by a stable pair identifier — so that the
  same ballots always produce the same order.
- **FR-019**: The system MUST display the number of ballots any percentages are based on, and MUST
  state explicitly when a group has no ballots instead of displaying zero percentages.
- **FR-020**: The system MUST withhold a group's aggregate results from a visitor who has neither
  voted on that group nor waited for voting to close, and MUST reveal them immediately after that
  visitor's ballot is accepted.
- **FR-021**: The system MUST make aggregate results public once voting has closed, to voters and
  non-voters alike.
- **FR-022**: The system MUST NOT expose, through any public view or interface, data that identifies
  an individual voter or lets an individual ballot be attributed to a device or person.

**History**

- **FR-023**: The system MUST retain every published tournament, its groups, its pairs, and its
  ballots indefinitely, and MUST list past tournaments newest first.
- **FR-024**: The system MUST show, for a past tournament, its final crowd predicted standings,
  per-position percentages, and ballot counts.
- **FR-025**: The system MUST show, for a player, every tournament that player appeared in with the
  partner and group of each appearance.
- **FR-026**: The system MUST keep space in its records for a tournament's real final standings
  without requiring them, so that comparing prediction to reality can be added later without
  discarding data collected now.

### Key Entities *(include if feature involves data)*

- **Player**: one real person. Canonical external identifier taken from the published ranking list,
  display name, normalised match key, current club. Exists independently of any tournament.
- **Ranking snapshot**: a player's ranking points as published on a given date, used to populate and
  refresh player data and to capture points at publish time.
- **Tournament**: a named event with a start instant that also serves as the voting deadline, a
  publication state, and a creation time. Owns groups.
- **Group**: a subset of a tournament's pairs — normally six — that play each other; the unit of
  voting and of results.
- **Pair**: two players competing together in one tournament's group, with the club they represent,
  each player's captured points, the pair's total points, and its seed position within the group.
- **Voter**: an anonymous, device-scoped identity used only to enforce one ballot per group and to
  show a visitor their own ballot. Carries no personal data.
- **Ballot**: one voter's complete ordering of one group's pairs, recorded once, immutable, with the
  instant it was cast.
- **Group results**: the derived per-position percentages, average predicted positions, crowd
  predicted order, and ballot count for a group.
- **Final standings (reserved)**: the real finishing order of a group, recordable later; not
  populated by this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An organiser can take a lineup of 12 pairs from structured data to a published,
  publicly votable tournament in under 2 minutes, with no manual re-typing of player names.
- **SC-002**: A first-time visitor can complete a ballot for one group of six in under 60 seconds
  without instructions, on a phone.
- **SC-003**: 100% of published tournaments have every player resolved to a ranking-list identity;
  the system never creates a silently guessed player record.
- **SC-004**: Percentages and predicted order shown for a group match, exactly, the values computed
  by hand from that group's recorded ballots, for every group in an audit of a full tournament.
- **SC-005**: Results for a group appear to the voter within 2 seconds of their ballot being
  accepted.
- **SC-006**: No sequence of public requests can retrieve an individual ballot, a voter identifier,
  or a group's percentages before that requester has voted or voting has closed — verified by
  automated tests covering each public read path.
- **SC-007**: A ballot submitted after the tournament's start instant is refused 100% of the time,
  including when the client's clock is wrong.
- **SC-008**: A player appearing in 5 tournaments is stored exactly once, and their history view
  lists all 5 appearances.
- **SC-009**: A tournament page serving 200 visitors voting within the same 10-minute window records
  every valid ballot exactly once, with no duplicate ballots per voter per group.
- **SC-010**: The web client and a future mobile client can produce identical voting and results
  behaviour against the same published interface, with no rule re-implemented per platform.
- **SC-011**: A voter can complete and submit a ballot using only a keyboard, and using a screen
  reader, with every control labelled, focus always visible, text contrast at least 4.5:1, and the
  recorded vote announced — verified on the voting form and the results view.

## Assumptions

- Phase 1 ingests the lineup as structured data pasted by the organiser. Extracting the lineup from a
  photograph or spreadsheet screenshot is explicitly deferred; the preview-and-publish step is
  designed to be the place where an automated extractor plugs in later.
- The published club ranking list is the authority for player identity and provides a stable numeric
  identifier and a name per player. It is publicly readable without credentials.
- Player names in a lineup payload match the ranking list exactly apart from case, accent
  composition, and whitespace. No fuzzy or nickname matching is attempted in phase 1.
- Groups normally contain exactly six pairs; a lineup that does not divide evenly produces one
  smaller final group, which is voted and scored over its own size.
- Voting is anonymous by design. One ballot per group per device is the intended strength of
  duplicate prevention; a private window or a second device counts as another voter, and that is
  accepted.
- Ballots are immutable once submitted. There is no vote editing or withdrawal in phase 1.
- A group's percentages are hidden from a visitor until they vote on that group, then shown; once
  voting closes they are public to everyone.
- Real final standings and per-voter accuracy scoring are out of scope for phase 1, with record
  space reserved so they can be added without migrating away collected data.
- Expected scale is club-sized: tens of tournaments per year, hundreds of ballots per tournament.
- Portuguese (pt-PT) is the primary display language, with English as fallback; all times are
  presented in Europe/Lisbon.
- A single organiser account is sufficient; multi-organiser roles and permissions are out of scope.
