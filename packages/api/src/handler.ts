import type { VoterId } from '@padelmigas/contracts/common';
import type {
  BallotRepository,
  Clock,
  GroupRepository,
  HistoryRepository,
  LineupImageReader,
  PairRepository,
  PlayerRepository,
  RankingSource,
  RatingRepository,
  ResultsRepository,
  TournamentRepository,
  VoterRepository,
} from '@padelmigas/core';

/**
 * The application layer.
 *
 * Every operation the product performs is a `Handler`: a pure function of `(input, deps)`. It reads
 * no globals, constructs no clients, and knows nothing about HTTP — the route file above it parses
 * the request and serialises the result, and nothing else (Principle II).
 *
 * That shape is what makes the two stated futures cheap. Re-hosting behind Fastify is one file per
 * route calling the same handlers; a mobile client is a second consumer of the same contracts. In
 * both cases `packages/core` and this package are untouched (SC-010).
 */

/**
 * Everything a handler is allowed to reach.
 *
 * Assembled once per process by the host (`apps/web/src/server/deps.ts`), which is the single module
 * permitted to import `packages/db`. A handler that needs a new capability gains a port here, never
 * a direct import.
 */
export interface Deps {
  readonly clock: Clock;
  readonly players: PlayerRepository;
  readonly ratings: RatingRepository;
  readonly tournaments: TournamentRepository;
  readonly groups: GroupRepository;
  readonly pairs: PairRepository;
  readonly voters: VoterRepository;
  readonly ballots: BallotRepository;
  readonly results: ResultsRepository;
  readonly history: HistoryRepository;
  readonly rankings: RankingSource;
  /**
   * Reads a lineup screenshot (FR-101).
   *
   * Optional, and its absence is a supported deployment state rather than a misconfiguration: with
   * no extraction configured the product is fully usable through hand entry, and the one endpoint
   * that needs it answers `EXTRACTION_UNAVAILABLE` (FR-119, FR-120, ADR-011).
   */
  readonly imageReader?: LineupImageReader;
}

/**
 * A single application operation.
 *
 * `TInput` is already-parsed and already-valid: parsing happens in the adapter against the Zod
 * schema in `packages/contracts`, so a handler never re-validates shape. It validates *rules*.
 */
export type Handler<TInput, TOutput> = (input: TInput, deps: Deps) => Promise<TOutput>;

/** A handler that takes no input beyond its dependencies (the rankings sync is the only one today). */
export type NullaryHandler<TOutput> = (deps: Deps) => Promise<TOutput>;

/**
 * The caller's identity as the application understands it.
 *
 * Deliberately minimal and deliberately never echoed: a voter id must not appear in any response
 * body or header (FR-022, contracts/README rule 6). `voterId` is `null` for a first-time visitor
 * who has not been minted a cookie yet.
 */
export interface CallerContext {
  readonly voterId: VoterId | null;
}

/**
 * Input for a handler whose answer depends on who is asking — the reveal gate (FR-020, FR-021).
 *
 * Responses built from this shape are always `Cache-Control: no-store`; caching them is Risk R1's
 * exact failure mode.
 */
export type VoterScoped<TInput> = TInput & { readonly caller: CallerContext };
