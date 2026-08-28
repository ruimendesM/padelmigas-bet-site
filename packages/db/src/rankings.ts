import type { Clock, RankingFetch, RankingSource } from '@padelmigas/core';
import type { Sql } from './client.js';
import { instant, str, type Row } from './mappers.js';

/**
 * The public ranking sheet as a port implementation (F1, Risk R3).
 *
 * Two behaviours the risk register asks for, made explicit:
 *  - **Fail, never guess.** An unreachable or non-CSV response throws. Inventing a player identity
 *    is worse than a loud import failure (FR-004, ADR-007).
 *  - **Keep the bytes.** Every successful fetch is stored verbatim, so an unreachable sheet can be
 *    served from the last good copy and a future parsing change can be re-run against the same
 *    input that produced a past import.
 */

export interface RankingSourceConfig {
  readonly csvUrl: string;
  /**
   * The instant the fetch is stamped with.
   *
   * Injected rather than read here: `Clock` is the system's only source of "now" (SC-007), and a
   * test that pins the clock must see the snapshot dated at the pinned instant, not at the real one.
   */
  readonly clock: Clock;
  /** Abort a slow sheet rather than holding a serverless invocation open. */
  readonly timeoutMs?: number;
}

/** Rough row count for the staleness warning; the real parse happens in `core/rankings`. */
function countDataRows(csv: string): number {
  const lines = csv.split('\n').filter((line) => line.trim().length > 0);
  return Math.max(0, lines.length - 1);
}

export function createRankingSource(sql: Sql, config: RankingSourceConfig): RankingSource {
  return {
    async fetchLatest() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 20_000);
      try {
        // The Google Sheets CSV export answers 307 before 200; `redirect: 'follow'` is the default
        // but stated here because the whole fetch depends on it (F1).
        const response = await fetch(config.csvUrl, {
          redirect: 'follow',
          signal: controller.signal,
          headers: { Accept: 'text/csv,text/plain,*/*' },
        });

        if (!response.ok) {
          throw new Error(
            `Ranking source responded ${response.status} ${response.statusText}. Refusing to import.`,
          );
        }

        const csv = await response.text();
        if (csv.trim().length === 0) {
          throw new Error('Ranking source returned an empty body. Refusing to import.');
        }
        // An HTML error page from the sheet host would otherwise parse as one nonsense column.
        if (/^\s*<(!doctype|html)/i.test(csv)) {
          throw new Error(
            'Ranking source returned HTML rather than CSV — the sheet is probably not public. ' +
              'Refusing to import.',
          );
        }

        return { csv, fetchedAt: config.clock.now() };
      } finally {
        clearTimeout(timeout);
      }
    },

    async storeSnapshot(fetched: RankingFetch) {
      await sql`
        insert into ranking_snapshots (csv, fetched_at, row_count)
        values (${fetched.csv}, ${fetched.fetchedAt}, ${countDataRows(fetched.csv)})
      `;
    },

    async lastSnapshot() {
      const rows = await sql<Row[]>`
        select csv, fetched_at
        from ranking_snapshots
        order by fetched_at desc
        limit 1
      `;
      const row = rows[0];
      if (!row) return null;
      return { csv: str(row, 'csv'), fetchedAt: instant(row, 'fetched_at') };
    },
  };
}
