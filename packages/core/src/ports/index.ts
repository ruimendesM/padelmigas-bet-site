import type {
  ExternalPlayerId,
  GroupId,
  PairId,
  PlayerId,
  TournamentId,
  VoterId,
} from '@padelmigas/contracts/common';
import type {
  Appearance,
  Ballot,
  BallotEntry,
  Group,
  GroupWithPairs,
  Pair,
  Player,
  PositionCount,
  RatingSnapshot,
  Tournament,
  TournamentStatus,
  TournamentWithGroups,
  Voter,
} from '../domain/index.js';

/**
 * Repository interfaces — the seam between the domain and any store (Principle II).
 *
 * `packages/core` declares these; `packages/db` implements them against Postgres; `packages/api`
 * receives them as `deps` and never learns which store it is talking to. Swapping the store, or
 * standing the API up as its own service, replaces implementations of these interfaces and nothing
 * else (SC-010).
 *
 * Two rules hold throughout:
 *  - No method here reads the clock. Time enters through `Clock` so the window decision has exactly
 *    one source (SC-007, Risk R5).
 *  - Methods that must be atomic say so in their contract, because the operation's correctness
 *    depends on it (FR-007, FR-010) — not as an implementation hint.
 */

// ---------------------------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------------------------

/**
 * The only source of "now" in the system.
 *
 * The voting window is decided from the server clock alone; no client-supplied timestamp is ever
 * consulted (SC-007). Injecting it is also what makes the boundary instant testable, which the
 * 100%-branch requirement on `core/window` needs.
 */
export interface Clock {
  now(): Date;
}

// ---------------------------------------------------------------------------------------------
// Players and ratings
// ---------------------------------------------------------------------------------------------

/** A player row as the importer wants to write it, before an id exists. */
export interface PlayerUpsert {
  readonly externalId: ExternalPlayerId;
  readonly displayName: string;
  readonly matchKey: string;
  readonly club: string | null;
}

export interface PlayerUpsertResult {
  readonly created: number;
  readonly updated: number;
  readonly players: readonly Player[];
}

export interface PlayerRepository {
  /**
   * Looks up players by normalised match key.
   *
   * Returns only the keys that exist; the caller reports the misses (FR-004 requires a loud failure,
   * never a silent auto-create).
   */
  findByMatchKeys(matchKeys: readonly string[]): Promise<readonly Player[]>;

  findById(id: PlayerId): Promise<Player | null>;

  /**
   * Upserts players by `external_id`, atomically.
   *
   * Must be a single transaction: a partially applied import would leave the ranking source and the
   * local identities disagreeing, which is the failure ADR-007 exists to prevent.
   */
  upsertMany(players: readonly PlayerUpsert[]): Promise<PlayerUpsertResult>;
}

export interface RatingRepository {
  /** Writes dated snapshots idempotently — re-running a sync rewrites the same rows (FR-004). */
  upsertSnapshots(snapshots: readonly RatingSnapshot[]): Promise<number>;

  /**
   * The most recent points on record per player, used to fill a lineup preview.
   * Absent from the map when a player has no snapshot at all.
   */
  latestPointsFor(playerIds: readonly PlayerId[]): Promise<ReadonlyMap<PlayerId, number>>;

  /** The date of the newest snapshot in the store, or `null` when the table is empty (Risk R3). */
  latestRatedOn(): Promise<string | null>;
}

// ---------------------------------------------------------------------------------------------
// Tournaments, groups, pairs
// ---------------------------------------------------------------------------------------------

/** Everything needed to publish, already validated and resolved by `core/lineup`. */
export interface TournamentPublication {
  readonly name: string;
  readonly slug: string;
  readonly startsAt: Date;
  readonly publishedAt: Date;
  readonly groups: readonly {
    readonly label: string;
    readonly position: number;
    readonly pairs: readonly {
      readonly club: string;
      readonly seed: number;
      readonly totalPoints: number;
      readonly members: readonly [
        { readonly playerId: PlayerId; readonly points: number },
        { readonly playerId: PlayerId; readonly points: number },
      ];
    }[];
  }[];
}

export interface TournamentListItem {
  readonly tournament: Tournament;
  readonly groupCount: number;
  /** Ballots across every group of this tournament (FR-019 — never a per-group figure here). */
  readonly ballotCount: number;
}

export interface TournamentListQuery {
  readonly status: TournamentStatus | 'all';
  readonly limit: number;
  readonly cursor: string | null;
  /** Server time, supplied by the caller from `Clock` so the store never decides open vs closed. */
  readonly now: Date;
}

export interface TournamentListPage {
  readonly items: readonly TournamentListItem[];
  readonly nextCursor: string | null;
}

export interface TournamentRepository {
  findBySlug(slug: string): Promise<TournamentWithGroups | null>;

  findById(id: TournamentId): Promise<Tournament | null>;

  slugExists(slug: string): Promise<boolean>;

  /**
   * Inserts the tournament, its groups and its pairs in ONE transaction (FR-007).
   *
   * Atomicity is the contract, not an optimisation: a half-published tournament would appear on the
   * landing page with missing groups, and Risk R9 is precisely about bad public data.
   */
  publish(publication: TournamentPublication): Promise<TournamentWithGroups>;

  /** Published tournaments, newest first, cursor-paginated (FR-023). Drafts are never returned. */
  listPublished(query: TournamentListQuery): Promise<TournamentListPage>;
}

export interface GroupRepository {
  /** A group with its pairs, or `null`. Used by the ballot path to validate membership (FR-010). */
  findById(id: GroupId): Promise<GroupWithPairs | null>;

  findByTournament(tournamentId: TournamentId): Promise<readonly GroupWithPairs[]>;

  /** The group's tournament, needed to decide the window without a second round trip. */
  findTournamentForGroup(id: GroupId): Promise<Tournament | null>;
}

export interface PairRepository {
  findByGroup(groupId: GroupId): Promise<readonly Pair[]>;

  findById(id: PairId): Promise<Pair | null>;
}

// ---------------------------------------------------------------------------------------------
// Voters and ballots
// ---------------------------------------------------------------------------------------------

export interface VoterRepository {
  /** Mints a new anonymous voter (ADR-004). No IP, no user agent, no personal data. */
  create(): Promise<Voter>;

  findById(id: VoterId): Promise<Voter | null>;

  /**
   * Refreshes `last_seen_at` for a recognised voter.
   *
   * Best-effort by design: a failure here must never fail the request the voter actually made.
   */
  touch(id: VoterId): Promise<void>;
}

/** A validated ballot ready to store. Ids are assigned by the store. */
export interface BallotInsert {
  readonly groupId: GroupId;
  readonly voterId: VoterId;
  readonly ordering: readonly BallotEntry[];
}

export type BallotInsertOutcome =
  | { readonly kind: 'inserted'; readonly ballot: Ballot }
  /**
   * The `UNIQUE (group_id, voter_id)` constraint rejected it. Surfaced as an outcome rather than a
   * thrown driver error so the handler answers `409 ALREADY_VOTED` instead of a 500 — the exact
   * failure Risk R7 names, under two concurrent submissions.
   */
  | { readonly kind: 'already-voted' };

export interface BallotRepository {
  /**
   * Inserts the ballot and all of its entries in ONE transaction (FR-010).
   *
   * Atomicity is the contract: "a rejected ballot leaves nothing behind" is a stated requirement,
   * and a ballot with a missing entry would silently skew every percentage in the group.
   */
  insert(ballot: BallotInsert): Promise<BallotInsertOutcome>;

  /** This voter's ballot for this group, or `null`. Drives `hasVoted`/`ownBallot` (FR-014). */
  findOwn(groupId: GroupId, voterId: VoterId): Promise<Ballot | null>;

  /**
   * Which of these groups this voter has voted on.
   *
   * One call per tournament page rather than one per group: the detail response needs the answer for
   * every group at once.
   */
  votedGroupIds(groupIds: readonly GroupId[], voterId: VoterId): Promise<ReadonlySet<GroupId>>;
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

/** Raw counts for one group. `ballotCount` of 0 means no results object is produced (FR-019). */
export interface GroupCounts {
  readonly ballotCount: number;
  readonly positionCounts: readonly PositionCount[];
}

export interface ResultsRepository {
  /** Reads `group_ballot_counts` and `group_position_counts` for one group (FR-016). */
  countsForGroup(groupId: GroupId): Promise<GroupCounts>;

  /** The same, for every group of a tournament, so the detail page needs one round trip. */
  countsForGroups(groupIds: readonly GroupId[]): Promise<ReadonlyMap<GroupId, GroupCounts>>;
}

// ---------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------

export interface HistoryRepository {
  /** Every appearance of a player, newest tournament first, joined through `pairs` (FR-025). */
  appearancesFor(playerId: PlayerId): Promise<readonly Appearance[]>;
}

// ---------------------------------------------------------------------------------------------
// Ranking source
// ---------------------------------------------------------------------------------------------

export interface RankingFetch {
  readonly csv: string;
  readonly fetchedAt: Date;
}

/**
 * The public ranking sheet (F1).
 *
 * `fetchLatest` must fail rather than return partial or invented data: Risk R3's whole point is that
 * guessing a player identity is worse than a loud import failure.
 */
export interface RankingSource {
  fetchLatest(): Promise<RankingFetch>;

  /** Persists the raw CSV so an unreachable source can fall back to the last good copy (Risk R3). */
  storeSnapshot(fetch: RankingFetch): Promise<void>;

  /** The last stored snapshot, or `null` when none has ever been taken. */
  lastSnapshot(): Promise<RankingFetch | null>;
}

/** Re-exported so implementers get one import for the whole port surface. */
export type { Group, GroupWithPairs, Pair, Player, Tournament, TournamentWithGroups, Voter };
