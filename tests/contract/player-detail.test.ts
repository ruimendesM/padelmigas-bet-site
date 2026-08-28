import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiErrorWithIssues, PlayerDetailDto } from '@padelmigas/contracts';
import { GET } from '../../apps/web/app/api/v1/players/[playerId]/route.js';
import {
  createGroup,
  createPair,
  createPlayer,
  createRating,
  createTournament,
} from '../factories/index.js';
import { rawSql } from './harness.js';
import { body, getRequest, install, params } from './helpers.js';

/**
 * `GET /api/v1/players/{playerId}` (FR-025, SC-008).
 *
 * SC-008 is an identity property, not a formatting one: one real person is one player record with a
 * continuous history. The central test therefore plays the same person in two tournaments and
 * asserts a single document with two appearances — a duplicate identity would show as a split
 * history, which is exactly what ADR-007 exists to prevent.
 */

const NOW = new Date('2026-09-01T12:00:00.000Z');

function url(playerId: string): string {
  return `http://localhost/api/v1/players/${playerId}`;
}

describe('GET /api/v1/players/{playerId}', () => {
  beforeEach(() => {
    install({ now: NOW });
  });

  it('returns the player with the partner, group label and points from each tournament', async () => {
    const sql = rawSql();
    const subject = await createPlayer(sql, { displayName: 'Sujeito de Teste' });
    const partner = await createPlayer(sql, { displayName: 'Parceiro de Teste' });
    await createRating(sql, subject.id, { points: 415, ratedOn: '2026-08-26' });

    const tournament = await createTournament(sql, {
      name: 'Torneio de Agosto',
      slug: 'torneio-de-agosto',
      startsAt: new Date('2026-12-01T18:00:00.000Z'),
    });
    const group = await createGroup(sql, tournament.id, { label: 'B', position: 2 });
    await createPair(sql, group.id, {
      seed: 1,
      player1Id: subject.id,
      player2Id: partner.id,
      player1Points: 380,
      player2Points: 350,
    });

    const response = await GET(getRequest(url(subject.id)), params({ playerId: subject.id }));
    expect(response.status).toBe(200);

    const player = await body<PlayerDetailDto>(response);
    expect(player.id).toBe(subject.id);
    expect(player.name).toBe('Sujeito de Teste');
    expect(player.externalId).toBe(subject.externalId);
    // The newest rating on record, which is not the points captured at the tournament.
    expect(player.currentPoints).toBe(415);

    expect(player.appearances).toHaveLength(1);
    const appearance = player.appearances[0];
    expect(appearance?.tournament.slug).toBe('torneio-de-agosto');
    expect(appearance?.groupLabel).toBe('B');
    expect(appearance?.partner.id).toBe(partner.id);
    expect(appearance?.partner.name).toBe('Parceiro de Teste');
    // FR-007: what was true on the day, not what is true today.
    expect(appearance?.pointsAtTournament).toBe(380);
  });

  it('returns one record with a continuous history across several tournaments (SC-008)', async () => {
    const sql = rawSql();
    const subject = await createPlayer(sql, { displayName: 'Sujeito Recorrente' });

    for (const [index, slug] of ['torneio-um', 'torneio-dois', 'torneio-tres'].entries()) {
      const partner = await createPlayer(sql, { displayName: `Parceiro ${index}` });
      const tournament = await createTournament(sql, {
        slug,
        publishedAt: new Date(Date.UTC(2026, 5 + index, 1, 10)),
        startsAt: new Date(Date.UTC(2026, 6 + index, 1, 18)),
      });
      const group = await createGroup(sql, tournament.id, { label: 'A', position: 1 });
      await createPair(sql, group.id, {
        seed: 1,
        player1Id: subject.id,
        player2Id: partner.id,
        player1Points: 300 + index,
      });
    }

    const player = await body<PlayerDetailDto>(
      await GET(getRequest(url(subject.id)), params({ playerId: subject.id })),
    );
    expect(player.appearances).toHaveLength(3);
    // Newest tournament first.
    expect(player.appearances.map((a) => a.tournament.slug)).toEqual([
      'torneio-tres',
      'torneio-dois',
      'torneio-um',
    ]);
    expect(player.appearances.map((a) => a.pointsAtTournament)).toEqual([302, 301, 300]);
    // Every appearance names a different partner, and none of them is the subject.
    expect(player.appearances.every((a) => a.partner.id !== subject.id)).toBe(true);
  });

  it('finds the player whether they were listed first or second in the pair', async () => {
    const sql = rawSql();
    const subject = await createPlayer(sql, { displayName: 'Segundo da Dupla' });
    const partner = await createPlayer(sql, { displayName: 'Primeiro da Dupla' });
    const tournament = await createTournament(sql, { slug: 'ordem-invertida' });
    const group = await createGroup(sql, tournament.id, { label: 'A', position: 1 });
    await createPair(sql, group.id, {
      seed: 1,
      player1Id: partner.id,
      player2Id: subject.id,
      player1Points: 400,
      player2Points: 250,
    });

    const player = await body<PlayerDetailDto>(
      await GET(getRequest(url(subject.id)), params({ playerId: subject.id })),
    );
    expect(player.appearances).toHaveLength(1);
    expect(player.appearances[0]?.partner.id).toBe(partner.id);
    // Their own points, not the pair's first slot.
    expect(player.appearances[0]?.pointsAtTournament).toBe(250);
  });

  it('returns a player who has never played, with no appearances and no rating', async () => {
    const subject = await createPlayer(rawSql(), { displayName: 'Nunca Jogou' });
    const player = await body<PlayerDetailDto>(
      await GET(getRequest(url(subject.id)), params({ playerId: subject.id })),
    );
    expect(player.appearances).toEqual([]);
    expect(player.currentPoints).toBeNull();
  });

  it('never exposes an appearance in an unpublished tournament', async () => {
    const sql = rawSql();
    const subject = await createPlayer(sql, { displayName: 'Em Rascunho' });
    const draft = await createTournament(sql, { slug: 'rascunho', publishedAt: null });
    const group = await createGroup(sql, draft.id, { label: 'A', position: 1 });
    await createPair(sql, group.id, { seed: 1, player1Id: subject.id });

    const player = await body<PlayerDetailDto>(
      await GET(getRequest(url(subject.id)), params({ playerId: subject.id })),
    );
    expect(player.appearances).toEqual([]);
  });

  it('answers 404 for an unknown player', async () => {
    const missing = '00000000-0000-4000-8000-000000000999';
    const response = await GET(getRequest(url(missing)), params({ playerId: missing }));
    expect(response.status).toBe(404);
    expect((await body<ApiErrorWithIssues>(response)).code).toBe('NOT_FOUND');
  });

  it('answers 400 for an id that is not a uuid', async () => {
    const response = await GET(getRequest(url('nonsense')), params({ playerId: 'nonsense' }));
    expect(response.status).toBe(400);
  });
});
