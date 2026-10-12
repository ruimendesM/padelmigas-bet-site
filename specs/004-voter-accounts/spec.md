# Feature Specification: Optional Voter Accounts

**Feature Branch**: `004-voter-accounts`

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "Optional voter accounts (short name: voter-accounts). Visitors can keep voting logged out exactly as today (anonymous device identity). Optionally, a visitor can register with a self-chosen username and a password (no email), sign in, sign out, and change their password. A signed-in person's "already voted" state and own ballot follow them across devices. If someone voted logged out on a device and then registers there, those votes become the account's. If they sign in on a device where they voted logged out, those votes move to the account for groups the account hasn't voted in; where both voted in the same group, the account's vote wins and the device's anonymous vote is discarded. Signing out returns the device to a fresh anonymous visitor. Forgotten password: the organiser can find an account by username and reset its password, which shows a one-time temporary password; the person must change it at next sign-in, and existing sessions for that account end. Nothing else for accounts in this feature (no profiles, no leaderboard). Google sign-in is out of scope (follow-up). pt-PT copy."

> **Numbering note**: requirements and criteria in this spec are numbered from 301 so they never
> collide with features 001 (FR-001…, SC-001…), 002 (FR-101…, SC-101…) or 003 (FR-201…, SC-201…).

## Clarifications

### Session 2026-10-12

- Q: When someone signs in on a device where they voted logged out in a group whose voting has
  already closed, should that ballot still move to the account? → A: Move ballots for every group;
  on a conflict in a closed group keep both ballots (the device's stays with the device's logged-out
  identity), so a closed group's totals never change.
- Q: Should the organiser's temporary password stop working after a set time if unused? → A: Yes,
  it expires 24 hours after the reset.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register and keep my vote across devices (Priority: P1)

Today a visitor's vote is remembered only by the browser they voted from. On a second phone, a
laptop, or after clearing the browser, the site no longer knows they voted: it offers the ballot
again and hides the crowd results it would otherwise reveal to them.

A visitor chooses a username and a password and creates an account. From then on, wherever they
sign in, the site knows which groups they voted in, shows their own ballot, and reveals results
exactly as it does on the device they voted from. Anything they had already voted on that device
before registering stays theirs.

**Why this priority**: this is the reason the feature exists — a vote that follows the person, not
the browser.

**Independent Test**: vote on a group logged out, register on the same device, then sign in from a
second browser and confirm the group shows as voted with the same ballot and its results revealed.

**Acceptance Scenarios**:

1. **Given** a visitor who is not signed in, **When** they register with an available username and a
   valid password, **Then** an account is created and they are signed in on that device.
2. **Given** a visitor who voted on one or more groups on this device before registering, **When**
   they register, **Then** those ballots belong to the new account and keep counting exactly once.
3. **Given** a signed-in person who voted on a group, **When** they sign in on another device,
   **Then** that group shows their own ballot and results as revealed, and they cannot vote on it
   again.
4. **Given** a signed-in person, **When** they vote on a group from any device, **Then** every
   device where they are signed in treats that group as voted.
5. **Given** a username already taken (ignoring letter case), **When** someone tries to register it,
   **Then** registration is refused with a message saying the username is not available.
6. **Given** a username or password that breaks the rules (FR-303, FR-304), **When** someone tries to
   register, **Then** registration is refused with a message naming the rule broken.

---

### User Story 2 - Sign in on a device where I already voted logged out (Priority: P1)

A person with an account opens the tournament link on a phone where they are not signed in and
votes, then remembers to sign in. Their logged-out votes must not be lost, and they must never end
up with two ballots in the same group.

**Why this priority**: without this, signing in either loses votes or lets one person vote twice in
a group, which would undermine the one-ballot rule the whole site rests on.

**Independent Test**: with an account that voted on group A only, vote logged out on groups A and B
on a fresh device, then sign in there. Group A keeps the account's original ballot, group B now
belongs to the account, and each group counts the person once.

**Acceptance Scenarios**:

1. **Given** a device whose logged-out visitor voted on a group the account has not voted on,
   **When** the person signs in on that device, **Then** that ballot becomes the account's.
2. **Given** a device whose logged-out visitor voted on an open group the account has already voted
   on, **When** the person signs in on that device, **Then** the account's ballot is kept, the
   device's logged-out ballot is discarded, and the group's totals count the person once.
3. **Given** the same conflict in a group whose voting has closed, **When** the person signs in,
   **Then** neither ballot changes and the group's totals stay as they were.
4. **Given** a device that has never voted, **When** the person signs in, **Then** nothing about
   ballots changes other than the device now showing the account's votes.
5. **Given** wrong credentials, **When** someone tries to sign in, **Then** sign-in is refused with
   one message that does not reveal whether the username exists, and no ballots move.

---

### User Story 3 - Keep voting without an account (Priority: P1)

Most people will tap the tournament link and vote without ever registering. That must stay exactly
as it is today: no prompt that blocks voting, no extra step.

**Why this priority**: turnout on a link shared minutes before a tournament is what makes the site
useful; accounts must not cost a single vote.

**Independent Test**: on a fresh browser, open a tournament with voting open and cast a ballot
without registering; it is accepted and results are revealed exactly as before this feature.

**Acceptance Scenarios**:

1. **Given** a visitor who is not signed in, **When** they vote, **Then** the ballot is accepted with
   no sign-in or registration step.
2. **Given** a visitor who is not signed in, **When** they view a tournament, **Then** they may see an
   optional invitation to sign in so their vote follows them, which never blocks voting.

---

### User Story 4 - Sign out and change my password (Priority: P2)

A person signs in on a shared or borrowed device and wants to leave it without their account
attached. Separately, they want to change their password.

**Why this priority**: needed for safe use on shared phones and required by the reset flow
(Story 5), but the core value is delivered without it.

**Independent Test**: sign in, sign out, and confirm the device no longer shows the account's
votes; then sign in again and change the password, confirming only the new one works.

**Acceptance Scenarios**:

1. **Given** a signed-in person, **When** they sign out, **Then** the device no longer shows the
   account's ballots and behaves as a brand-new logged-out visitor.
2. **Given** a signed-in person, **When** they change their password supplying the current one and a
   valid new one, **Then** the new password works from then on and the old one does not.
3. **Given** a wrong current password, **When** they try to change it, **Then** the change is
   refused and the password is unchanged.
4. **Given** a person signed in on several devices, **When** they change their password on one,
   **Then** they stay signed in on that device and are signed out everywhere else.

---

### User Story 5 - Organiser resets a forgotten password (Priority: P2)

There is no email, so a person who forgets their password cannot recover it alone. They ask the
organiser, who finds the account by username in the private organiser area and resets its password.
The organiser sees a temporary password once and passes it on. When the person signs in with it,
they must choose a new password before doing anything else.

**Why this priority**: without it a forgotten password permanently strands the account's votes;
it is rare, so it ranks below the core flows.

**Independent Test**: as organiser, reset an account's password; confirm the person's existing
sessions end, the temporary password signs in, the person is required to set a new one, and they
can then vote.

**Acceptance Scenarios**:

1. **Given** the organiser, **When** they search by part of a username, **Then** matching accounts
   are listed by username.
2. **Given** the organiser resets an account's password, **Then** a temporary password is shown to
   the organiser once and cannot be retrieved again afterwards.
3. **Given** a reset account, **When** anyone uses a session that was signed in before the reset,
   **Then** that session is no longer signed in.
4. **Given** a reset account, **When** the person signs in with the temporary password, **Then**
   they must set a new password before they can vote or see the account's votes.
5. **Given** a temporary password issued more than 24 hours ago and never used, **When** the person
   tries to sign in with it, **Then** sign-in is refused with the same message as wrong credentials.
6. **Given** a visitor who is not the organiser, **When** they attempt to search accounts or reset a
   password, **Then** the request is refused.

---

### Edge Cases

- **Two devices race to vote on the same group for one account**: exactly one ballot is accepted;
  the other is told the group is already voted.
- **Register on a device whose logged-out visitor is already part of another account** (e.g. signed
  out, then registered a second account): the new account starts with no ballots; the other
  account's ballots are not taken.
- **Sign in to account B on a device just signed out of account A**: the device is a fresh visitor
  after sign-out, so no ballots of A move to B.
- **Logged-out ballot in a group whose voting has already closed**, then sign-in: if the account has
  not voted there, the ballot moves to the account like any other. If the account has also voted
  there, neither ballot is touched: the device's ballot stays with the device's former logged-out
  identity and keeps counting, so the closed group's totals do not change (FR-311).
- **Sign in while a merge would discard a logged-out ballot**: the person is not asked to choose;
  the account's ballot wins (FR-311).
- **Ballot carried over by a tournament replacement (feature 003)** belongs to the same voter, so it
  follows the account like any other ballot.
- **Repeated failed sign-ins** from one network are slowed down so passwords cannot be guessed at
  speed.
- **Username typed with different capitals** at sign-in matches the account.

## Requirements *(mandatory)*

### Functional Requirements

**Logged-out voting**

- **FR-301**: Voting MUST NOT require an account. Logged-out visitors MUST keep voting, seeing their
  own ballot on the same device, and having results revealed exactly as before this feature.
- **FR-302**: The system MUST NOT store visitors' network addresses to decide who has voted;
  logged-out "already voted" state stays tied to the device as today.

**Registration and credentials**

- **FR-303**: A username MUST be 3–30 characters of lowercase letters, digits, dot, hyphen, or
  underscore; input is lower-cased before checking. Usernames MUST be unique ignoring letter case.
- **FR-304**: A password MUST be 8–128 characters. No other composition rule applies.
- **FR-305**: Registration MUST collect only a username and a password; no email or other personal
  data.
- **FR-306**: Passwords MUST never be stored or shown in readable form, and MUST never be sent to the
  visitor's browser after submission.
- **FR-307**: Successful registration MUST sign the person in on that device.

**One person, one ballot per group**

- **FR-308**: An account MUST count as a single voter: across all devices where it is signed in, it
  holds at most one ballot per group.
- **FR-309**: On registration, ballots already cast on that device by its logged-out visitor MUST
  become the new account's, unless that visitor already belongs to another account.
- **FR-310**: On sign-in, each ballot cast by the device's logged-out visitor in a group the account
  has not voted in MUST become the account's.
- **FR-311**: On sign-in, where the device's logged-out visitor and the account both voted in the
  same group **and that group's voting is still open**, the account's ballot MUST be kept and the
  device's ballot discarded, so the group counts the person once. If that group's voting has
  closed, neither ballot MUST change: the device's ballot stays with the device's former logged-out
  identity, so a closed group's totals never change after closing.
- **FR-312**: FR-309–FR-311 MUST apply all-or-nothing: either every move and discard happens, or
  none does and sign-in fails.
- **FR-313**: A logged-out visitor that already belongs to an account MUST never have its ballots
  moved to a different account.

**Sessions**

- **FR-314**: Sign-in MUST accept a username and password and refuse wrong credentials with a single
  message that does not reveal whether the username exists.
- **FR-315**: Signed-in sessions MUST last 90 days unless signed out, the password changes, or the
  password is reset.
- **FR-316**: Signing out MUST end the session on that device and return the device to a brand-new
  logged-out visitor with no ballots.
- **FR-317**: Registration and sign-in attempts MUST be rate-limited per network so passwords cannot
  be guessed at speed, without storing the network address.

**Password change and reset**

- **FR-318**: A signed-in person MUST be able to change their password by supplying the current one
  and a new valid one. Doing so MUST end every other session of that account and keep the current
  one.
- **FR-319**: The organiser MUST be able to search accounts by part of a username and reset an
  account's password from the private organiser area. Only the organiser can do this.
- **FR-320**: A reset MUST generate a temporary password, show it to the organiser exactly once, and
  end every existing session of that account. The temporary password MUST stop working 24 hours
  after the reset if it has not been used to sign in; the organiser can then reset again.
- **FR-321**: A person signed in with a temporary password MUST set a new password before they can
  vote or see the account's ballots.

**Presentation**

- **FR-322**: Every page MUST show whether the visitor is signed in (with their username) or offer
  sign-in and registration. Signed-in visitors MUST be able to reach sign-out and password change.
- **FR-323**: All new copy MUST be in pt-PT.

### Key Entities

- **Account**: a person's optional sign-in identity — a unique username, a protected password, when
  it was created, when its password last changed, whether it must set a new password, and when a
  pending temporary password expires. Owns
  exactly one Voter.
- **Voter** (existing, from feature 001): the identity ballots belong to. Logged-out visitors have a
  device-bound voter; an account owns one voter that every device signed in to it uses.
- **Session**: a device's proof that it is signed in to an account, valid until it expires, is
  signed out, or is ended by a password change or reset.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-301**: A new visitor can register in under 1 minute.
- **SC-302**: A signed-in person sees the correct voted state for 100% of groups on every device
  where they are signed in.
- **SC-303**: 0 groups whose voting is open count the same account more than once, including after
  any sequence of logged-out votes, registrations, and sign-ins. 0 closed groups change their
  totals because of a sign-in.
- **SC-304**: 0 ballots cast logged out on a device are lost when their owner registers or signs in
  there, except those in open groups the account had already voted in.
- **SC-305**: A logged-out visitor can still vote in the same number of taps as before this feature.
- **SC-306**: A person who forgot their password can vote again within 5 minutes of the organiser
  resetting it.
- **SC-307**: No stored record allows reading any account's password.

## Assumptions

- Accounts are optional and expected to be used by a minority of voters; the logged-out flow
  remains the main path.
- The single organiser credential from feature 001 is the only organiser; there are no organiser
  roles.
- No email means no self-service recovery; organiser reset (Story 5) is the only recovery path.
- Usernames are not shown publicly in this feature (no profiles or leaderboards).
- Accounts do not stop someone from voting again logged out or with a second account; heavier
  anti-abuse stays out of scope, as the constitution allows.
- Account deletion is out of scope for this feature.
- Google or any other third-party sign-in is out of scope and will be its own spec.
