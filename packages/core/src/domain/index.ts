import type {
  BallotId,
  ExternalPlayerId,
  GroupId,
  PairId,
  PlayerId,
  TournamentId,
  VoterId,
} from '@padelmigas/contracts/common';

/**
 * Domain types.
 *
 * These describe the product's nouns independently of both the wire format (packages/contracts) and
 * the storage rows (packages/db). Keeping the three separate is what lets the database gain a column
 * or the API gain a field without the domain noticing.
 *
 * Instants are `Date`. The domain never *reads* the clock — that is the `Clock` port — it only
 * carries instants that were read for it.
 */

export interface Player {
  readonly id: PlayerId;
  /** The ranking sheet's `ID` column: canonical identity across syncs (FR-004). */
  readonly externalId: ExternalPlayerId;
  readonly displayName: string;
  /** Normalised name produced by `core/matching`. Never derived in SQL (ADR-007). */
  readonly matchKey: string;
  readonly club: string | null;
}

/** A dated rating snapshot from the sheet's dated columns. */
export interface RatingSnapshot {
  readonly playerId: PlayerId;
  /** Calendar date, not an instant: the sheet's columns are days. */
  readonly ratedOn: string;
  readonly points: number;
}

/**
 * Derived tournament state (data-model.md). Never stored: the single `core/window` module decides it
 * from `publishedAt`, `startsAt` and the injected clock, so there is exactly one place a
 * lock-boundary bug can live (Risk R5).
 */
export type TournamentStatus = 'draft' | 'open' | 'closed';

export interface Tournament {
  readonly id: TournamentId;
  readonly name: string;
  readonly slug: string;
  /** Also the voting deadline (FR-011). */
  readonly startsAt: Date;
  /** `null` means draft: never publicly visible. */
  readonly publishedAt: Date | null;
}

export interface Group {
  readonly id: GroupId;
  readonly tournamentId: TournamentId;
  readonly label: string;
  /** 1-based display order. */
  readonly position: number;
}

/** A player as they appeared in one tournament, with the points captured then (FR-007). */
export interface PairMember {
  readonly playerId: PlayerId;
  readonly displayName: string;
  readonly points: number;
}

export interface Pair {
  readonly id: PairId;
  readonly groupId: GroupId;
  readonly club: string;
  readonly members: readonly [PairMember, PairMember];
  readonly totalPoints: number;
  /** 1-based rank within the group. */
  readonly seed: number;
}

export interface Voter {
  readonly id: VoterId;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
}

/** One pair placed at one position. */
export interface BallotEntry {
  readonly pairId: PairId;
  readonly position: number;
}

export interface Ballot {
  readonly id: BallotId;
  readonly groupId: GroupId;
  readonly voterId: VoterId;
  readonly castAt: Date;
  readonly ordering: readonly BallotEntry[];
}

/** Raw counts from `group_position_counts`; percentages are computed in `core/scoring` (ADR-006). */
export interface PositionCount {
  readonly pairId: PairId;
  readonly position: number;
  readonly votes: number;
}

/** A group with its pairs — the unit voting and scoring both operate on. */
export interface GroupWithPairs extends Group {
  readonly pairs: readonly Pair[];
}

/** A tournament with its groups, as the detail page and the publish result both need it. */
export interface TournamentWithGroups extends Tournament {
  readonly groups: readonly GroupWithPairs[];
}

/** One appearance of a player in one tournament (FR-025). */
export interface Appearance {
  readonly tournament: Tournament;
  readonly groupLabel: string;
  readonly partner: { readonly id: PlayerId; readonly name: string };
  /** The player's own points as captured at that tournament, not their points today (FR-007). */
  readonly pointsAtTournament: number;
  readonly ballotCount: number;
  readonly groupCount: number;
}
