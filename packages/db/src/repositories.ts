import type {
  BallotRepository,
  Clock,
  GroupRepository,
  HistoryRepository,
  PairRepository,
  PlayerRepository,
  RankingSource,
  RatingRepository,
  ResultsRepository,
  TournamentRepository,
  VoterRepository,
} from '@padelmigas/core';
import { createBallotRepository, createVoterRepository } from './ballots.js';
import type { Sql } from './client.js';
import { systemClock } from './clock.js';
import { createGroupRepository, createPairRepository } from './groups.js';
import { createHistoryRepository } from './history.js';
import { createPlayerRepository, createRatingRepository } from './players.js';
import { createRankingSource } from './rankings.js';
import { createResultsRepository } from './results.js';
import { createTournamentRepository } from './tournaments.js';

/**
 * One-call assembly of every port implementation.
 *
 * The host's `deps.ts` calls this and nothing else, which keeps the number of modules that know
 * about `packages/db` at exactly one (Principle II). The shape deliberately matches `Deps` in
 * `packages/api` field for field, so adding a port is a compile error in both places rather than a
 * silent gap in one.
 */

export interface Repositories {
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
}

export interface RepositoriesConfig {
  readonly rankingsCsvUrl: string;
  /** Overridable so tests can pin the boundary instant `core/window` is asserted at (SC-007). */
  readonly clock?: Clock;
}

export function createRepositories(sql: Sql, config: RepositoriesConfig): Repositories {
  const clock = config.clock ?? systemClock;
  return {
    clock,
    players: createPlayerRepository(sql),
    ratings: createRatingRepository(sql),
    tournaments: createTournamentRepository(sql),
    groups: createGroupRepository(sql),
    pairs: createPairRepository(sql),
    voters: createVoterRepository(sql),
    ballots: createBallotRepository(sql),
    results: createResultsRepository(sql),
    history: createHistoryRepository(sql),
    rankings: createRankingSource(sql, { csvUrl: config.rankingsCsvUrl, clock }),
  };
}
