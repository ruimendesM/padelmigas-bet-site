/**
 * Public surface of @padelmigas/db — the Supabase Postgres adapter.
 *
 * This package implements the ports declared in `@padelmigas/core` and is the only module permitted
 * to construct a database client (Principle II, ADR-003 as amended). Nothing outside
 * `apps/web/src/server/deps.ts` may import it; `.dependency-cruiser.cjs` enforces both halves.
 */
export { closeSharedSql, createSql, getSql } from './client.js';
export type { DbConfig, Sql } from './client.js';
export { fixedClock, systemClock } from './clock.js';
export { createBallotRepository, createVoterRepository } from './ballots.js';
export { createGroupRepository, createPairRepository } from './groups.js';
export { createHistoryRepository } from './history.js';
export { createPlayerRepository, createRatingRepository } from './players.js';
export { createRankingSource } from './rankings.js';
export type { RankingSourceConfig } from './rankings.js';
export { createResultsRepository } from './results.js';
export { createTournamentRepository } from './tournaments.js';
export { decodeCursor, encodeCursor } from './tournament-list.js';
export { createRepositories } from './repositories.js';
export type { Repositories, RepositoriesConfig } from './repositories.js';
