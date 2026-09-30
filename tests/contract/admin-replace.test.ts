import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ApiErrorWithIssues,
  PlayerDetailDto,
  ReplacementPreviewDto,
  TournamentDetailDto,
  TournamentListResponse,
} from '@padelmigas/contracts';
import { POST as publishRoute } from '../../apps/web/app/api/v1/admin/tournaments/route.js';
import { POST as previewRoute } from '../../apps/web/app/api/v1/admin/tournaments/[slug]/replace/preview/route.js';
import { POST as replaceRoute } from '../../apps/web/app/api/v1/admin/tournaments/[slug]/replace/route.js';
import { POST as ballotRoute } from '../../apps/web/app/api/v1/groups/[groupId]/ballots/route.js';
import { GET as resultsRoute } from '../../apps/web/app/api/v1/groups/[groupId]/results/route.js';
import { GET as detailRoute } from '../../apps/web/app/api/v1/tournaments/[slug]/route.js';
import { GET as listRoute } from '../../apps/web/app/api/v1/tournaments/route.js';
import { GET as playerRoute } from '../../apps/web/app/api/v1/players/[playerId]/route.js';
import { VOTER_COOKIE_NAME } from '../../apps/web/src/server/voter-cookie.js';
import { createPlayer } from '../factories/index.js';
import { rawSql } from './harness.js';
import {
  body,
  cookieFrom,
  getRequest,
  install,
  jsonRequest,
  organiserCookie,
  params,
} from './helpers.js';

/**
 * Replacing an open tournament (feature 003).
 *
 * `POST /api/v1/admin/tournaments/{slug}/replace/preview` and `.../replace`, plus what a replacement
 * changes on the public endpoints: carried-over ballots (FR-206 – FR-209), the invalidated record
 * (FR-210 – FR-212), the withheld reveal (FR-213), and player history (FR-214).
 */

const NOW = new Date('2026-09-01T12:00:00.000Z');
const START = '2026-12-01T18:00:00.000Z';
const AFTER_START = new Date('2026-12-01T18:00:00.000Z');
const SLUG = 'torneio-de-outubro';
const BASE = 'http://localhost/api/v1';

interface PayloadPair {
  club: string;
  totalPoints: number;
  group?: string;
  players: [{ name: string; points: number }, { name: string; points: number }];
}

interface Lineup {
  name: string;
  startsAt: string;
  pairs: PayloadPair[];
}

/** Twelve known pairs → groups A (first six by points) and B (last six). */
async function seedLineup(): Promise<{ lineup: Lineup; spare: string }> {
  const sql = rawSql();
  const pairs: PayloadPair[] = [];
  for (let index = 0; index < 12; index += 1) {
    const first = await createPlayer(sql, { displayName: `Jogador Um ${index}` });
    const second = await createPlayer(sql, { displayName: `Jogador Dois ${index}` });
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
  const spare = await createPlayer(sql, { displayName: 'Jogador Suplente' });
  return {
    lineup: { name: 'Torneio de Outubro', startsAt: START, pairs },
    spare: spare.displayName,
  };
}

/** The same lineup with one player of group B's last pair swapped for `spare`. */
function withGroupBChanged(lineup: Lineup, spare: string): Lineup {
  const pairs = lineup.pairs.map((pair) => ({
    ...pair,
    players: [...pair.players],
  })) as PayloadPair[];
  const last = pairs[11]!;
  last.players[1] = { name: spare, points: last.players[1].points };
  return { ...lineup, pairs };
}

async function publish(lineup: Lineup): Promise<TournamentDetailDto> {
  const response = await publishRoute(
    jsonRequest(
      `${BASE}/admin/tournaments`,
      { ...lineup, slug: SLUG, confirm: true },
      {
        cookie: await organiserCookie(),
      },
    ),
  );
  expect(response.status).toBe(201);
  return body<TournamentDetailDto>(response);
}

/** Casts a seed-order ballot on `groupId`, returning the voter cookie to reuse. */
async function vote(
  group: TournamentDetailDto['groups'][number],
  cookie?: string,
): Promise<{ status: number; cookie: string }> {
  const response = await ballotRoute(
    jsonRequest(
      `${BASE}/groups/${group.id}/ballots`,
      { ordering: group.pairs.map((pair, index) => ({ pairId: pair.id, position: index + 1 })) },
      cookie === undefined ? {} : { cookie },
    ),
    params({ groupId: group.id }),
  );
  return {
    status: response.status,
    cookie: cookie ?? cookieFrom(response, VOTER_COOKIE_NAME) ?? '',
  };
}

async function preview(slug: string, lineup: Lineup, cookie?: string): Promise<Response> {
  return previewRoute(
    jsonRequest(`${BASE}/admin/tournaments/${slug}/replace/preview`, lineup, {
      cookie: cookie ?? (await organiserCookie()),
    }),
    params({ slug }),
  );
}

async function replace(slug: string, lineup: Lineup, confirm: boolean = true): Promise<Response> {
  return replaceRoute(
    jsonRequest(
      `${BASE}/admin/tournaments/${slug}/replace`,
      confirm ? { ...lineup, confirm: true } : lineup,
      { cookie: await organiserCookie() },
    ),
    params({ slug }),
  );
}

async function detail(slug: string, cookie?: string): Promise<TournamentDetailDto> {
  const response = await detailRoute(
    getRequest(`${BASE}/tournaments/${slug}`, cookie === undefined ? {} : { cookie }),
    params({ slug }),
  );
  expect(response.status).toBe(200);
  return body<TournamentDetailDto>(response);
}

/** Standings keyed by pair player names, so results from two tournaments can be compared. */
function standingsByNames(tournament: TournamentDetailDto, label: string) {
  const group = tournament.groups.find((g) => g.label === label)!;
  const names = new Map(group.pairs.map((p) => [p.id, p.players.map((x) => x.name).join(' / ')]));
  return group.results?.standings.map((s) => ({
    pair: names.get(s.pairId),
    predictedPosition: s.predictedPosition,
    shares: s.positionShares.map((x) => [x.position, x.votes]),
  }));
}

/** Publish, then voter 1 votes A and B, voter 2 votes A only. */
async function scenario() {
  const { lineup, spare } = await seedLineup();
  const original = await publish(lineup);
  const [groupA, groupB] = original.groups;
  const voter1 = await vote(groupA!);
  await vote(groupB!, voter1.cookie);
  const voter2 = await vote(groupA!);
  return { lineup, spare, original, voter1: voter1.cookie, voter2: voter2.cookie };
}

describe('POST /api/v1/admin/tournaments/{slug}/replace/preview', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('marks which groups keep their votes and persists nothing', async () => {
    const { lineup, spare } = await scenario();
    const response = await preview(SLUG, withGroupBChanged(lineup, spare));

    expect(response.status).toBe(200);
    const payload = await body<ReplacementPreviewDto>(response);
    expect(payload.slug).toBe(SLUG);
    expect(payload.replaces.slug).toBe(SLUG);
    expect(payload.groups.map((g) => [g.label, g.carryOver])).toEqual([
      ['A', { keepsVotes: true, ballotCount: 2 }],
      ['B', { keepsVotes: false, ballotCount: 0 }],
    ]);

    const tournaments = await rawSql()`select count(*)::int as count from tournaments`;
    expect(tournaments[0]?.['count']).toBe(1);
  });

  it('keeps votes on a group whose pairs only changed points, seed order or player order', async () => {
    const { lineup } = await scenario();
    const pairs = lineup.pairs.map((pair) => ({
      ...pair,
      players: [...pair.players],
    })) as PayloadPair[];
    // Group A's second pair: players listed the other way round and a point more each, which moves
    // it above the first pair.
    const moved = pairs[1]!;
    moved.players = [
      { name: moved.players[1].name, points: 301 },
      { name: moved.players[0].name, points: 301 },
    ];
    moved.totalPoints = 602;

    const payload = await body<ReplacementPreviewDto>(await preview(SLUG, { ...lineup, pairs }));
    expect(payload.groups[0]?.carryOver).toEqual({ keepsVotes: true, ballotCount: 2 });
  });

  it('restarts groups whose pairs moved to a different label', async () => {
    const { lineup } = await scenario();
    // Explicit groups, swapped: A's pairs labelled B and B's labelled A (FR-206: label must match).
    const pairs = lineup.pairs.map((pair, index) => ({ ...pair, group: index < 6 ? 'B' : 'A' }));
    const payload = await body<ReplacementPreviewDto>(await preview(SLUG, { ...lineup, pairs }));
    expect(payload.groups.every((g) => !g.carryOver.keepsVotes)).toBe(true);
  });

  it('answers NOT_FOUND for an unknown tournament', async () => {
    const { lineup } = await seedLineup();
    const response = await preview('nao-existe', lineup);
    expect(response.status).toBe(404);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('NOT_FOUND');
  });

  it('answers NOT_REPLACEABLE once voting has closed', async () => {
    const { lineup } = await scenario();
    install({ now: AFTER_START });
    const response = await preview(SLUG, lineup);
    expect(response.status).toBe(409);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('NOT_REPLACEABLE');
  });

  it('rejects an invalid lineup exactly as a new lineup is rejected', async () => {
    const { lineup } = await scenario();
    const pairs = lineup.pairs.map((pair) => ({
      ...pair,
      players: [...pair.players],
    })) as PayloadPair[];
    pairs[0]!.players[0] = { name: 'Ninguém Conhecido', points: 300 };
    const response = await preview(SLUG, { ...lineup, pairs });
    expect(response.status).toBe(400);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('UNRESOLVED_PLAYERS');
  });

  it('refuses an unauthenticated caller', async () => {
    const { lineup } = await scenario();
    const response = await preview(SLUG, lineup, '');
    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/admin/tournaments/{slug}/replace', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('publishes the replacement at the original address and invalidates the original', async () => {
    const { lineup, spare, original } = await scenario();
    const response = await replace(SLUG, withGroupBChanged(lineup, spare));

    expect(response.status).toBe(201);
    const replacement = await body<TournamentDetailDto>(response);
    expect(replacement.slug).toBe(SLUG);
    expect(replacement.id).not.toBe(original.id);
    expect(replacement.status).toBe('open');
    // Group A's two ballots came along; group B's one did not (FR-207, FR-209).
    expect(replacement.ballotCount).toBe(2);
    expect(replacement.invalidation).toBeUndefined();

    const rows = await rawSql()<{ slug: string; invalidated: boolean; replaced_by_id: string }[]>`
      select slug, invalidated_at is not null as invalidated, replaced_by_id
      from tournaments where id = ${original.id}
    `;
    expect(rows[0]).toEqual({
      slug: `${SLUG}-invalidado-1`,
      invalidated: true,
      replaced_by_id: replacement.id,
    });
    expect((await detail(SLUG)).id).toBe(replacement.id);
  });

  it('carries each voter’s ballot on unchanged groups with identical results', async () => {
    const { lineup, spare, voter1 } = await scenario();
    const before = await detail(SLUG, voter1);
    await replace(SLUG, withGroupBChanged(lineup, spare));
    const after = await detail(SLUG, voter1);

    const [a, b] = after.groups;
    expect(a?.hasVoted).toBe(true);
    // Own ballot mapped onto the replacement's pair ids (FR-208).
    const pairIds = new Set(a!.pairs.map((pair) => pair.id));
    expect(a?.ownBallot?.ordering.every((entry) => pairIds.has(entry.pairId))).toBe(true);
    expect(a?.results?.ballotCount).toBe(2);
    // SC-203: same counts, same percentages, same order.
    expect(standingsByNames(after, 'A')).toEqual(standingsByNames(before, 'A'));

    expect(b?.hasVoted).toBe(false);
    expect(b?.votingOpen).toBe(true);
    expect(b?.results).toBeUndefined();

    // The voter may vote on the changed group (FR-209) but not again on the carried one.
    expect((await vote(b!, voter1)).status).toBe(201);
    expect((await vote(a!, voter1)).status).toBe(409);
  });

  it('refuses ballots on the invalidated tournament', async () => {
    const { lineup, spare, original } = await scenario();
    await replace(SLUG, withGroupBChanged(lineup, spare));

    const response = await ballotRoute(
      jsonRequest(`${BASE}/groups/${original.groups[1]!.id}/ballots`, {
        ordering: original.groups[1]!.pairs.map((pair, index) => ({
          pairId: pair.id,
          position: index + 1,
        })),
      }),
      params({ groupId: original.groups[1]!.id }),
    );
    expect(response.status).toBe(422);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('VOTING_CLOSED');
  });

  it('answers NOT_REPLACEABLE for a tournament that was already replaced', async () => {
    const { lineup, spare } = await scenario();
    await replace(SLUG, withGroupBChanged(lineup, spare));
    const response = await replace(`${SLUG}-invalidado-1`, lineup);
    expect(response.status).toBe(409);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('NOT_REPLACEABLE');
  });

  it('can replace a replacement, carrying unchanged groups again', async () => {
    const { lineup, spare } = await scenario();
    await replace(SLUG, withGroupBChanged(lineup, spare));
    const second = await body<TournamentDetailDto>(await replace(SLUG, lineup));

    expect(second.slug).toBe(SLUG);
    expect(second.ballotCount).toBe(2);
    const slugs = await rawSql()<{ slug: string }[]>`select slug from tournaments order by slug`;
    expect(slugs.map((r) => r.slug)).toEqual([
      SLUG,
      `${SLUG}-invalidado-1`,
      `${SLUG}-invalidado-2`,
    ]);
  });

  it('refuses without an explicit confirmation and changes nothing', async () => {
    const { lineup } = await scenario();
    const response = await replace(SLUG, lineup, false);
    expect(response.status).toBe(400);
    const tournaments = await rawSql()`select count(*)::int as count from tournaments`;
    expect(tournaments[0]?.['count']).toBe(1);
  });

  it('leaves the original untouched when the lineup is invalid', async () => {
    const { lineup, original } = await scenario();
    const pairs = lineup.pairs.map((pair) => ({
      ...pair,
      players: [...pair.players],
    })) as PayloadPair[];
    pairs[0]!.players[0] = { name: 'Ninguém Conhecido', points: 300 };
    const response = await replace(SLUG, { ...lineup, pairs });
    expect(response.status).toBe(400);
    const still = await detail(SLUG);
    expect(still.id).toBe(original.id);
    expect(still.status).toBe('open');
  });
});

describe('the invalidated tournament in public views', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('is marked, links to its replacement, and withholds results while the replacement is open', async () => {
    const { lineup, spare, voter1, original } = await scenario();
    await replace(SLUG, withGroupBChanged(lineup, spare));

    const invalidated = await detail(`${SLUG}-invalidado-1`, voter1);
    expect(invalidated.status).toBe('closed');
    expect(invalidated.invalidation?.replacedBy).toEqual({ slug: SLUG, name: lineup.name });
    expect(invalidated.invalidation?.resultsWithheld).toBe(true);
    // Even voter 1, who voted on both groups, sees no results here (FR-213).
    expect(invalidated.groups.every((g) => g.results === undefined && !g.votingOpen)).toBe(true);

    const hidden = await resultsRoute(
      getRequest(`${BASE}/groups/${original.groups[0]!.id}/results`, { cookie: voter1 }),
      params({ groupId: original.groups[0]!.id }),
    );
    expect(hidden.status).toBe(403);
    expect((await body<ApiErrorWithIssues>(hidden)).code).toBe('RESULTS_HIDDEN');
  });

  it('reveals the frozen results once the replacement has closed', async () => {
    const { lineup, spare } = await scenario();
    await replace(SLUG, withGroupBChanged(lineup, spare));
    install({ now: AFTER_START });

    const invalidated = await detail(`${SLUG}-invalidado-1`);
    expect(invalidated.invalidation?.resultsWithheld).toBe(false);
    expect(invalidated.groups.map((g) => g.results?.ballotCount)).toEqual([2, 1]);
  });

  it('is hidden from the default listing and shown in history with its mark', async () => {
    const { lineup, spare } = await scenario();
    await replace(SLUG, withGroupBChanged(lineup, spare));

    const all = await body<TournamentListResponse>(
      await listRoute(getRequest(`${BASE}/tournaments?status=all`)),
    );
    expect(all.tournaments.map((t) => t.slug)).toEqual([SLUG]);

    const open = await body<TournamentListResponse>(
      await listRoute(getRequest(`${BASE}/tournaments?status=open&includeInvalidated=true`)),
    );
    expect(open.tournaments.map((t) => t.slug)).toEqual([SLUG]);

    const history = await body<TournamentListResponse>(
      await listRoute(getRequest(`${BASE}/tournaments?status=closed&includeInvalidated=true`)),
    );
    expect(history.tournaments).toHaveLength(1);
    expect(history.tournaments[0]?.slug).toBe(`${SLUG}-invalidado-1`);
    expect(history.tournaments[0]?.invalidation).toMatchObject({
      replacedBy: { slug: SLUG },
      resultsWithheld: true,
    });
  });

  it('is left out of player history', async () => {
    const { lineup, spare } = await scenario();
    await replace(SLUG, withGroupBChanged(lineup, spare));

    const ids = await rawSql()<{ id: string; display_name: string }[]>`
      select id, display_name from players
      where display_name in (${lineup.pairs[11]!.players[1].name}, ${lineup.pairs[0]!.players[0].name})
    `;
    const byName = new Map(ids.map((row) => [row.display_name, row.id]));

    async function appearances(name: string): Promise<string[]> {
      const playerId = byName.get(name)!;
      const response = await playerRoute(
        getRequest(`${BASE}/players/${playerId}`),
        params({ playerId }),
      );
      return (await body<PlayerDetailDto>(response)).appearances.map((a) => a.tournament.slug);
    }

    // Swapped out: appeared only in the invalidated lineup.
    expect(await appearances(lineup.pairs[11]!.players[1].name)).toEqual([]);
    // Kept: listed once, for the replacement.
    expect(await appearances(lineup.pairs[0]!.players[0].name)).toEqual([SLUG]);
  });
});
