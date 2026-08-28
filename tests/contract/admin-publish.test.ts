import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiErrorWithIssues, TournamentDetailDto } from '@padelmigas/contracts';
import { POST } from '../../apps/web/app/api/v1/admin/tournaments/route.js';
import { createPlayer, createRating } from '../factories/index.js';
import { rawSql } from './harness.js';
import { body, install, jsonRequest, organiserCookie } from './helpers.js';

/**
 * `POST /api/v1/admin/tournaments` (FR-002, FR-006, FR-007).
 *
 * Publishing is the one irreversible public action in the product (Risk R9), so two properties get
 * as much attention as the happy path: it cannot happen without an explicit confirmation, and a
 * rejected publish leaves nothing behind.
 */

const URL = 'http://localhost/api/v1/admin/tournaments';
const START = '2026-12-01T18:00:00.000Z';

interface PayloadPair {
  club: string;
  totalPoints: number;
  group?: string;
  players: [{ name: string; points: number }, { name: string; points: number }];
}

async function knownPairs(count: number): Promise<PayloadPair[]> {
  const sql = rawSql();
  const pairs: PayloadPair[] = [];
  for (let index = 0; index < count; index += 1) {
    const first = await createPlayer(sql, { displayName: `Jogador Um ${index}` });
    const second = await createPlayer(sql, { displayName: `Jogador Dois ${index}` });
    // A rating on record so the "points captured at publish" assertion has something to differ from.
    await createRating(sql, first.id, { points: 999 });
    const points = 300 - index * 10;
    pairs.push({
      club: `Clube ${index}`,
      totalPoints: points * 2,
      players: [
        { name: first.displayName, points },
        { name: second.displayName, points },
      ],
    });
  }
  return pairs;
}

describe('POST /api/v1/admin/tournaments', () => {
  beforeEach(() => {
    install({ now: new Date('2026-09-01T12:00:00.000Z') });
  });

  it('creates the tournament with its derived groups and answers 201', async () => {
    const pairs = await knownPairs(6);
    const response = await POST(
      jsonRequest(
        URL,
        { name: 'Torneio de Setembro', startsAt: START, confirm: true, pairs },
        { cookie: await organiserCookie() },
      ),
    );

    expect(response.status).toBe(201);
    const detail = await body<TournamentDetailDto>(response);
    expect(detail.slug).toBe('torneio-de-setembro');
    expect(detail.status).toBe('open');
    expect(detail.groupCount).toBe(1);
    expect(detail.ballotCount).toBe(0);
    expect(detail.groups[0]?.pairs).toHaveLength(6);
    // Nobody has voted, so no group carries results and none claims a vote (FR-020).
    expect(detail.groups.every((group) => group.results === undefined)).toBe(true);
    expect(detail.groups.every((group) => group.hasVoted === false)).toBe(true);
  });

  it('captures each player’s points at publish time rather than their current rating', async () => {
    // FR-007: a later ranking sync must not rewrite what a past tournament shows.
    const pairs = await knownPairs(3);
    await POST(
      jsonRequest(
        URL,
        { name: 'Torneio de Pontos', startsAt: START, confirm: true, pairs },
        { cookie: await organiserCookie() },
      ),
    );

    const rows = await rawSql()<{ player_1_points: number }[]>`
      select player_1_points from pairs order by seed
    `;
    expect(rows[0]?.player_1_points).toBe(300);
    expect(rows.map((row) => row.player_1_points)).not.toContain(999);
  });

  it('refuses a publish that was not explicitly confirmed', async () => {
    const pairs = await knownPairs(3);
    const response = await POST(
      jsonRequest(
        URL,
        { name: 'Torneio', startsAt: START, confirm: false, pairs },
        { cookie: await organiserCookie() },
      ),
    );
    expect(response.status).toBe(400);
    const error = await body<ApiErrorWithIssues>(response);
    // Zod rejects the literal before the handler is reached, so the shape failure is what surfaces.
    expect(['MALFORMED_PAYLOAD', 'NOT_CONFIRMED']).toContain(error.code);
    expect((await rawSql()`select count(*)::int as count from tournaments`)[0]?.['count']).toBe(0);
  });

  it('rejects a caller with no organiser session and writes nothing', async () => {
    const pairs = await knownPairs(3);
    const response = await POST(
      jsonRequest(URL, { name: 'Torneio', startsAt: START, confirm: true, pairs }),
    );
    expect(response.status).toBe(401);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('UNAUTHORISED');
    expect((await rawSql()`select count(*)::int as count from tournaments`)[0]?.['count']).toBe(0);
  });

  it('rejects a slug already in use', async () => {
    const pairs = await knownPairs(3);
    const cookie = await organiserCookie();
    const payload = { name: 'Torneio Repetido', startsAt: START, confirm: true, pairs };

    expect((await POST(jsonRequest(URL, payload, { cookie }))).status).toBe(201);

    const second = await POST(jsonRequest(URL, payload, { cookie }));
    expect(second.status).toBe(409);
    expect((await body<ApiErrorWithIssues>(second)).code).toBe('SLUG_TAKEN');
    expect((await rawSql()`select count(*)::int as count from tournaments`)[0]?.['count']).toBe(1);
  });

  it('persists nothing when the lineup is rejected', async () => {
    // The atomicity FR-007 asks for, observed from outside: a failure leaves no tournament, no
    // group and no pair — not even the rows that were valid.
    const pairs = await knownPairs(3);
    pairs[0]!.players[0].name = 'Alguém Que Não Existe';

    const response = await POST(
      jsonRequest(
        URL,
        { name: 'Torneio', startsAt: START, confirm: true, pairs },
        { cookie: await organiserCookie() },
      ),
    );
    expect(response.status).toBe(400);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('UNRESOLVED_PLAYERS');

    const sql = rawSql();
    expect((await sql`select count(*)::int as count from tournaments`)[0]?.['count']).toBe(0);
    expect((await sql`select count(*)::int as count from groups`)[0]?.['count']).toBe(0);
    expect((await sql`select count(*)::int as count from pairs`)[0]?.['count']).toBe(0);
  });

  it('rejects a start instant that is not in the future', async () => {
    const pairs = await knownPairs(3);
    const response = await POST(
      jsonRequest(
        URL,
        { name: 'Torneio', startsAt: '2026-08-01T18:00:00.000Z', confirm: true, pairs },
        { cookie: await organiserCookie() },
      ),
    );
    expect(response.status).toBe(400);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('START_NOT_IN_FUTURE');
  });

  it('splits nine pairs into a full group of six and a short final group of three', async () => {
    // research D10: groups of six, with one smaller final group of 3–5.
    const pairs = await knownPairs(9);
    const response = await POST(
      jsonRequest(
        URL,
        { name: 'Torneio Grande', startsAt: START, confirm: true, pairs },
        { cookie: await organiserCookie() },
      ),
    );
    expect(response.status).toBe(201);
    const detail = await body<TournamentDetailDto>(response);
    expect(detail.groups.map((group) => group.pairs.length)).toEqual([6, 3]);
    expect(detail.groups.map((group) => group.label)).toEqual(['A', 'B']);
  });
});
