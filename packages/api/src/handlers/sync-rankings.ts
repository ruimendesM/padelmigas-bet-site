import type { RankingsSyncResponse } from '@padelmigas/contracts';
import type { PlayerId } from '@padelmigas/contracts/common';
import {
  domainError,
  isDomainError,
  parseRankingCsv,
  type RankingFetch,
  type RatingSnapshot,
} from '@padelmigas/core';
import type { NullaryHandler } from '../handler.js';

/**
 * Imports the public ranking sheet into players and dated rating snapshots (FR-004).
 *
 * Three properties this ordering exists to guarantee:
 *
 *  1. **Nothing is written until the whole sheet parses.** `parseRankingCsv` aborts on an ambiguous
 *     identity (ADR-007), and it runs before the first insert, so a `DUPLICATE_MATCH_KEY` leaves the
 *     database exactly as it was. A half-imported ranking is worse than none: every later lineup
 *     resolves against it.
 *  2. **An unreachable sheet degrades rather than fails.** The last stored snapshot is re-imported
 *     and the report says `stale: true` (Risk R3). Publishing must not be blocked because Google was
 *     briefly unavailable.
 *  3. **Re-running changes nothing.** Players upsert on `external_id` and snapshots upsert on
 *     `(player_id, rated_on)`, so a scheduler firing twice is a no-op the second time.
 */
export const syncRankings: NullaryHandler<RankingsSyncResponse> = async (deps) => {
  let fetched: RankingFetch;
  let stale = false;

  try {
    fetched = await deps.rankings.fetchLatest();
  } catch (fetchError) {
    const fallback = await deps.rankings.lastSnapshot();
    if (!fallback) {
      // No live sheet and nothing on record: there is nothing to import and nothing to fall back on,
      // so the caller must see the real failure rather than an empty success.
      throw domainError(
        'INTERNAL_ERROR',
        'A folha de ranking está inacessível e não existe nenhuma cópia anterior.',
        [
          {
            path: 'source',
            message: fetchError instanceof Error ? fetchError.message : String(fetchError),
          },
        ],
      );
    }
    fetched = fallback;
    stale = true;
  }

  // Parse first — see property (1).
  const parsed = parseRankingCsv(fetched.csv);

  // Only a live fetch is worth keeping; re-storing the fallback would multiply copies of the same
  // bytes every time the sheet stayed down.
  if (!stale) {
    await deps.rankings.storeSnapshot(fetched);
  }

  const upsert = await deps.players.upsertMany(
    parsed.players.map((player) => ({
      externalId: player.externalId,
      displayName: player.displayName,
      matchKey: player.matchKey,
      // The sheet carries no club column today (F1); a club already on record is left alone by the
      // repository rather than being overwritten with null.
      club: null,
    })),
  );

  // Keyed by `matchKey`, not `externalId` (FR-004 as amended 2026-08-28). The sheet reuses ids
  // across different people, so an id-keyed map silently collapses two players into one entry and
  // both of their snapshots then target the same `(player_id, rated_on)` in a single insert.
  const idByMatchKey = new Map<string, PlayerId>(
    upsert.players.map((player) => [player.matchKey, player.id]),
  );

  const snapshots: RatingSnapshot[] = [];
  for (const snapshot of parsed.snapshots) {
    const playerId = idByMatchKey.get(snapshot.matchKey);
    // A snapshot whose player did not come back from the upsert cannot be written; skipping it is
    // safe because the row is re-imported on the next run, and inventing a player id is not.
    if (!playerId) continue;
    snapshots.push({ playerId, ratedOn: snapshot.ratedOn, points: snapshot.points });
  }

  const snapshotsWritten = await deps.ratings.upsertSnapshots(snapshots);

  return {
    rowsRead: parsed.rowsRead,
    playersCreated: upsert.created,
    playersUpdated: upsert.updated,
    snapshotsWritten,
    sourceFetchedAt: fetched.fetchedAt.toISOString(),
    stale,
  };
};

/** Re-exported so the CLI in `tools/rankings-sync` can report a domain failure without re-deriving. */
export { isDomainError };
