import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiErrorWithIssues, RankingsSyncResponse } from '@padelmigas/contracts';
import { POST } from '../../apps/web/app/api/v1/admin/rankings/sync/route.js';
import { rankingCsv } from '../factories/index.js';
import { rawSql } from './harness.js';
import { body, current, install, organiserCookie } from './helpers.js';

/**
 * `POST /api/v1/admin/rankings/sync` (FR-004).
 *
 * The import is the identity spine of the whole product: every lineup name is resolved against what
 * this writes. So the two failure behaviours matter more than the success one — an ambiguous sheet
 * must abort with nothing written (ADR-007), and an unreachable sheet must degrade rather than block
 * publishing (Risk R3).
 */

const URL = 'http://localhost/api/v1/admin/rankings/sync';

function syncRequest(options: { cookie?: string; bearer?: string } = {}): Request {
  return new Request(URL, {
    method: 'POST',
    headers: {
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(options.bearer === undefined ? {} : { authorization: `Bearer ${options.bearer}` }),
    },
  });
}

const SHEET = rankingCsv([
  { id: 101, name: 'Alice Ferreira', points: [420, 400] },
  { id: 102, name: 'Bruno Marques', points: [380, 390] },
  { id: 103, name: 'Carla Nogueira', points: [310, 300] },
]);

describe('POST /api/v1/admin/rankings/sync', () => {
  beforeEach(() => {
    install({ now: new Date('2026-09-01T12:00:00.000Z') });
  });

  it('imports the sheet and reports the counts', async () => {
    const test = current();
    test.ranking.csv = SHEET;

    const response = await POST(syncRequest({ cookie: await organiserCookie() }));
    expect(response.status).toBe(200);
    const report = await body<RankingsSyncResponse>(response);
    expect(report.rowsRead).toBe(3);
    expect(report.playersCreated).toBe(3);
    expect(report.playersUpdated).toBe(0);
    // Two dated columns per player.
    expect(report.snapshotsWritten).toBe(6);
    expect(report.stale).toBe(false);
  });

  it('is idempotent: a second run creates nobody and updates everybody', async () => {
    const test = current();
    test.ranking.csv = SHEET;
    const cookie = await organiserCookie();

    await POST(syncRequest({ cookie }));
    const second = await POST(syncRequest({ cookie }));

    const report = await body<RankingsSyncResponse>(second);
    expect(report.playersCreated).toBe(0);
    expect(report.playersUpdated).toBe(3);
    const players = await rawSql()`select count(*)::int as count from players`;
    expect(players[0]?.['count']).toBe(3);
  });

  it('imports rows that share an ID, because the sheet reuses IDs across different people', async () => {
    // FR-004 as amended 2026-08-28. The real ranking sheet is maintained by a third party and its
    // `ID` column is not unique: 784 rows carry only 756 distinct IDs, 18 of them shared by 46 rows
    // describing different people. While a repeated ID was an import failure, every import of the
    // real sheet aborted and nothing could be published at all (ADR-007 § Amendment).
    const test = current();
    test.ranking.csv = rankingCsv([
      { id: 354, name: 'Alice Ferreira', points: [420, 400] },
      { id: 354, name: 'Bruno Marques', points: [380, 390] },
      { id: 355, name: 'Carla Nogueira', points: [310, 300] },
    ]);

    const response = await POST(syncRequest({ cookie: await organiserCookie() }));
    expect(response.status).toBe(200);
    const report = await body<RankingsSyncResponse>(response);
    expect(report.rowsRead).toBe(3);
    // Three distinct names means three distinct people, whatever the sheet says their IDs are.
    expect(report.playersCreated).toBe(3);

    const sql = rawSql();
    const players = await sql`select match_key, external_id from players order by match_key`;
    expect(players.map((row) => row['match_key'])).toEqual([
      'alice ferreira',
      'bruno marques',
      'carla nogueira',
    ]);
    // The ID is kept as informational metadata, repeats and all — it is simply no longer identity.
    expect(players.map((row) => row['external_id'])).toEqual([354, 354, 355]);
  });

  it('does not merge two people who share an ID when the import is re-run', async () => {
    // The failure this guards against is the dangerous one: upserting on a repeated `external_id`
    // would silently collapse two real people into one row on the second sync, and the loss would be
    // invisible because the row count would simply stop growing (data-model § `players`).
    const test = current();
    test.ranking.csv = rankingCsv([
      { id: 354, name: 'Alice Ferreira', points: [420, 400] },
      { id: 354, name: 'Bruno Marques', points: [380, 390] },
    ]);
    const cookie = await organiserCookie();

    await POST(syncRequest({ cookie }));
    const second = await POST(syncRequest({ cookie }));
    expect(second.status).toBe(200);

    const report = await body<RankingsSyncResponse>(second);
    expect(report.playersCreated).toBe(0);
    expect(report.playersUpdated).toBe(2);
    const players = await rawSql()`select count(*)::int as count from players`;
    expect(players[0]?.['count']).toBe(2);
  });

  it('aborts on an ambiguous name and leaves the database untouched', async () => {
    // Two people whose names normalise identically: no lineup name could be resolved with
    // confidence afterwards, so importing anything would be a guess (ADR-007).
    const test = current();
    test.ranking.csv = rankingCsv([
      { id: 201, name: 'Rodrigo da Costa', points: [400, 400] },
      { id: 202, name: 'Rodrigo Da Costa', points: [350, 350] },
    ]);

    const response = await POST(syncRequest({ cookie: await organiserCookie() }));
    expect(response.status).toBe(409);
    const error = await body<ApiErrorWithIssues>(response);
    expect(error.code).toBe('DUPLICATE_MATCH_KEY');
    expect(error.issues.length).toBeGreaterThan(0);

    const sql = rawSql();
    expect((await sql`select count(*)::int as count from players`)[0]?.['count']).toBe(0);
    expect((await sql`select count(*)::int as count from player_ratings`)[0]?.['count']).toBe(0);
    // Not even the raw snapshot: parsing precedes every write.
    expect((await sql`select count(*)::int as count from ranking_snapshots`)[0]?.['count']).toBe(0);
  });

  it('falls back to the last stored snapshot when the sheet is unreachable, and says so', async () => {
    const test = current();
    const cookie = await organiserCookie();

    test.ranking.csv = SHEET;
    await POST(syncRequest({ cookie }));

    // Now the sheet goes down. The import must still succeed from the stored copy (Risk R3).
    test.ranking.csv = null;
    test.ranking.failure = new Error('ranking source unreachable');

    const response = await POST(syncRequest({ cookie }));
    expect(response.status).toBe(200);
    const report = await body<RankingsSyncResponse>(response);
    expect(report.stale).toBe(true);
    expect(report.rowsRead).toBe(3);
    // Falling back must not multiply copies of the same bytes.
    const snapshots = await rawSql()`select count(*)::int as count from ranking_snapshots`;
    expect(snapshots[0]?.['count']).toBe(1);
  });

  it('fails loudly when the sheet is unreachable and nothing has ever been stored', async () => {
    const test = current();
    test.ranking.failure = new Error('ranking source unreachable');

    const response = await POST(syncRequest({ cookie: await organiserCookie() }));
    expect(response.status).toBe(500);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('INTERNAL_ERROR');
  });

  it('accepts the scheduler’s bearer CRON_SECRET', async () => {
    // The scheduler has no human session, and this is the only route that accepts the secret
    // (contracts/README rule 7).
    const test = current();
    test.ranking.csv = SHEET;
    const response = await POST(syncRequest({ bearer: process.env.CRON_SECRET ?? '' }));
    expect(response.status).toBe(200);
  });

  it('rejects a wrong bearer secret', async () => {
    const response = await POST(syncRequest({ bearer: 'not-the-secret' }));
    expect(response.status).toBe(401);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('UNAUTHORISED');
  });

  it('rejects a caller with neither a session nor the secret', async () => {
    const response = await POST(syncRequest());
    expect(response.status).toBe(401);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('UNAUTHORISED');
  });
});
