/**
 * Public surface of @padelmigas/api — the application layer.
 *
 * Handlers are `(input, deps) => Promise<output>` and import no host framework (Principle II). The
 * route files in `apps/web/app/api/v1/**` are adapters over these; a future standalone service
 * would be a second set of adapters over the same functions.
 */
export type { CallerContext, Deps, Handler, NullaryHandler, VoterScoped } from './handler.js';
export { previewLineup } from './handlers/preview-lineup.js';
export { extractLineup } from './handlers/extract-lineup.js';
export { publishTournament } from './handlers/publish-tournament.js';
export { syncRankings } from './handlers/sync-rankings.js';
export { listTournaments } from './handlers/list-tournaments.js';
export { getTournamentDetail } from './handlers/get-tournament-detail.js';
export type { TournamentDetailInput } from './handlers/get-tournament-detail.js';
export { castBallot } from './handlers/cast-ballot.js';
export type { CastBallotInput } from './handlers/cast-ballot.js';
export { getGroupResults } from './handlers/get-group-results.js';
export type { GroupResultsInput } from './handlers/get-group-results.js';
export { getPlayer } from './handlers/get-player.js';
export {
  toGroupDto,
  toGroupResultsDto,
  toOwnBallotDto,
  toPairDto,
  toTournamentSummaryDto,
} from './views.js';
export type { GroupViewState } from './views.js';
