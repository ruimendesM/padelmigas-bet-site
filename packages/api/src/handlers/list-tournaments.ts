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
    includeInvalidated: query.includeInvalidated,
    // Open vs closed is decided from the server clock alone and passed down; the store never reads
    // a clock of its own (SC-007).
    now,
  });

  // Invalidated items are rare (a correction, a handful a year) and each needs its live successor
  // for `resultsWithheld`, so one lookup per such item rather than a recursive join for all
  // (feature 003).
  const tournaments = await Promise.all(
    page.items.map(async (item) =>
      toTournamentSummaryDto(item.tournament, {
        groupCount: item.groupCount,
        ballotCount: item.ballotCount,
        now,
        ...(item.replacedBy === null
          ? {}
          : {
              replacement: {
                replacedBy: item.replacedBy,
                liveSuccessor: await deps.tournaments.findLiveSuccessor(item.tournament.id),
              },
            }),
      }),
    ),
  );

  return {
    tournaments,
    nextCursor: page.nextCursor,
  };
};
