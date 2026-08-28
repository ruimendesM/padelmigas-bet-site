import type { TournamentListQueryDto, TournamentListResponse } from '@padelmigas/contracts';
import type { Handler } from '../handler.js';
import { toTournamentSummaryDto } from '../views.js';

/**
 * The public tournament list (FR-023).
 *
 * Newest first, cursor-paginated, drafts excluded by the repository. The payload carries a
 * tournament-level ballot total and no per-group figure at all: a per-group count here would reveal
 * aggregate information for a group the caller has not earned (SC-006), and the shape is what keeps
 * that impossible.
 */
export const listTournaments: Handler<TournamentListQueryDto, TournamentListResponse> = async (
  query,
  deps,
) => {
  const now = deps.clock.now();

  const page = await deps.tournaments.listPublished({
    status: query.status,
    limit: query.limit,
    cursor: query.cursor ?? null,
    // Open vs closed is decided from the server clock alone and passed down; the store never reads
    // a clock of its own (SC-007).
    now,
  });

  return {
    tournaments: page.items.map((item) =>
      toTournamentSummaryDto(item.tournament, {
        groupCount: item.groupCount,
        ballotCount: item.ballotCount,
        now,
      }),
    ),
    nextCursor: page.nextCursor,
  };
};
