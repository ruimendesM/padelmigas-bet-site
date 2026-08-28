import { describe, expect, it } from 'vitest';
import type { ExternalPlayerId, PlayerId } from '@padelmigas/contracts';
import { DomainError } from '../errors.js';
import type { Player } from '../domain/index.js';
import { deriveLineup, type LineupInput } from './index.js';

/**
 * Lineup derivation and validation (FR-003, FR-005, FR-007, research D10).
 *
 * 100% branch coverage is required here: every rule in this module is a rule that stops bad data
 * reaching a public page (Risk R9), and the promise that *every* problem is reported at once (FR-005)
 * is only credible if each combination is tested.
 */

const NOW = new Date('2026-09-01T12:00:00.000Z');
const FUTURE = '2026-09-12T18:00:00.000Z';

let nextExternalId = 100;

function knownPlayer(name: string): Player {
  nextExternalId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextExternalId).padStart(12, '0')}` as PlayerId,
    externalId: nextExternalId as ExternalPlayerId,
    displayName: name,
    matchKey: name.toLowerCase(),
    club: 'Clube Fictício',
  };
}

/** `n` pairs with strictly descending totals, and the players they need. */
function pairsWithPlayers(count: number): {
  pairs: LineupInput['pairs'];
  players: Player[];
} {
  const players: Player[] = [];
  const pairs: LineupInput['pairs'] = [];

  for (let i = 0; i < count; i += 1) {
    const first = knownPlayer(`Primeiro Jogador ${i}`);
    const second = knownPlayer(`Segundo Jogador ${i}`);
    players.push(first, second);
    const firstPoints = 500 - i * 10;
    const secondPoints = 490 - i * 10;
    pairs.push({
      club: 'Clube Fictício',
      totalPoints: firstPoints + secondPoints,
      players: [
        { name: first.displayName, points: firstPoints },
        { name: second.displayName, points: secondPoints },
      ],
    });
  }

  return { pairs, players };
}

function input(overrides: Partial<LineupInput> = {}): LineupInput {
  const { pairs } = pairsWithPlayers(12);
  return {
    name: 'Torneio de Exemplo',
    startsAt: FUTURE,
    pairs,
    ...overrides,
  };
}

function expectDomainError(fn: () => unknown, code: string): DomainError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    const domain = error as DomainError;
    expect(domain.code).toBe(code);
    return domain;
  }
  throw new Error(`Expected a DomainError with code ${code}, but nothing was thrown.`);
}

describe('deriveLineup — grouping', () => {
  it('chunks 12 pairs into two groups of six, ordered by total points descending', () => {
    const { pairs, players } = pairsWithPlayers(12);
    const result = deriveLineup({ ...input({ pairs }), pairs }, players, NOW);

    expect(result.groups).toHaveLength(2);
    expect(result.groups.map((g) => g.label)).toEqual(['A', 'B']);
    expect(result.groups[0]?.pairs).toHaveLength(6);
    expect(result.groups[1]?.pairs).toHaveLength(6);

    // Group A holds the six strongest pairs; group B the rest.
    const groupATotals = result.groups[0]!.pairs.map((p) => p.totalPoints);
    const groupBTotals = result.groups[1]!.pairs.map((p) => p.totalPoints);
    expect(groupATotals).toEqual([...groupATotals].sort((a, b) => b - a));
    expect(Math.min(...groupATotals)).toBeGreaterThan(Math.max(...groupBTotals));
  });

  it('sorts pairs that arrive out of order', () => {
    const { pairs, players } = pairsWithPlayers(6);
    const shuffled = [pairs[3]!, pairs[0]!, pairs[5]!, pairs[1]!, pairs[4]!, pairs[2]!];
    const result = deriveLineup({ ...input({ pairs: shuffled }), pairs: shuffled }, players, NOW);

    const totals = result.groups[0]!.pairs.map((p) => p.totalPoints);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
  });

  it('assigns 1-based seeds within each group', () => {
    const { pairs, players } = pairsWithPlayers(12);
    const result = deriveLineup({ ...input({ pairs }), pairs }, players, NOW);

    expect(result.groups[0]!.pairs.map((p) => p.seed)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.groups[1]!.pairs.map((p) => p.seed)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('accepts a short final group of five', () => {
    // Research D10: an 11-pair entry list is real and must not be rejected.
    const { pairs, players } = pairsWithPlayers(11);
    const result = deriveLineup({ ...input({ pairs }), pairs }, players, NOW);

    expect(result.groups.map((g) => g.pairs.length)).toEqual([6, 5]);
  });

  it('accepts a short final group of three', () => {
    const { pairs, players } = pairsWithPlayers(9);
    const result = deriveLineup({ ...input({ pairs }), pairs }, players, NOW);

    expect(result.groups.map((g) => g.pairs.length)).toEqual([6, 3]);
  });

  it('rejects a derived final group of fewer than three pairs', () => {
    // 7 pairs would chunk to 6 + 1. A group of one has nothing to predict.
    const { pairs, players } = pairsWithPlayers(7);
    const error = expectDomainError(
      () => deriveLineup({ ...input({ pairs }), pairs }, players, NOW),
      'INVALID_GROUP_SIZE',
    );
    expect(error.issues[0]?.message).toContain('1');
  });

  it('honours explicit group labels instead of deriving them', () => {
    const { pairs, players } = pairsWithPlayers(6);
    const labelled = pairs.map((pair, index) => ({
      ...pair,
      group: index % 2 === 0 ? 'Norte' : 'Sul',
    }));

    const result = deriveLineup({ ...input({ pairs: labelled }), pairs: labelled }, players, NOW);

    expect(result.groups.map((g) => g.label)).toEqual(['Norte', 'Sul']);
    expect(result.groups.map((g) => g.pairs.length)).toEqual([3, 3]);
  });

  it('orders explicit groups by their strongest pair, and seeds within each', () => {
    const { pairs, players } = pairsWithPlayers(6);
    // Put the three strongest pairs in "Sul" so label order and strength order disagree.
    const labelled = pairs.map((pair, index) => ({
      ...pair,
      group: index < 3 ? 'Sul' : 'Norte',
    }));

    const result = deriveLineup({ ...input({ pairs: labelled }), pairs: labelled }, players, NOW);

    expect(result.groups[0]?.label).toBe('Sul');
    expect(result.groups.map((g) => g.position)).toEqual([1, 2]);
    expect(result.groups[0]!.pairs.map((p) => p.seed)).toEqual([1, 2, 3]);
  });

  it('rejects an explicit group with too many pairs', () => {
    const { pairs, players } = pairsWithPlayers(7);
    const labelled = pairs.map((pair) => ({ ...pair, group: 'Todos' }));

    const error = expectDomainError(
      () => deriveLineup({ ...input({ pairs: labelled }), pairs: labelled }, players, NOW),
      'INVALID_GROUP_SIZE',
    );
    expect(error.issues[0]?.message).toContain('Todos');
  });

  it('rejects a lineup where only some pairs name a group', () => {
    // A half-labelled payload is ambiguous: derive or honour? Refusing is the only safe answer.
    const { pairs, players } = pairsWithPlayers(6);
    const halfLabelled = pairs.map((pair, index) =>
      index === 0 ? { ...pair, group: 'Norte' } : pair,
    );

    expectDomainError(
      () => deriveLineup({ ...input({ pairs: halfLabelled }), pairs: halfLabelled }, players, NOW),
      'MALFORMED_PAYLOAD',
    );
  });
});

describe('deriveLineup — validation', () => {
  it('rejects a total that does not equal the sum of both players', () => {
    const { pairs, players } = pairsWithPlayers(6);
    const broken = pairs.map((pair, index) =>
      index === 2 ? { ...pair, totalPoints: pair.totalPoints + 1 } : pair,
    );

    const error = expectDomainError(
      () => deriveLineup({ ...input({ pairs: broken }), pairs: broken }, players, NOW),
      'POINTS_MISMATCH',
    );
    expect(error.issues[0]?.path).toBe('pairs[2].totalPoints');
  });

  it('reports every mismatched total at once', () => {
    const { pairs, players } = pairsWithPlayers(6);
    const broken = pairs.map((pair, index) =>
      index === 1 || index === 4 ? { ...pair, totalPoints: 0 } : pair,
    );

    const error = expectDomainError(
      () => deriveLineup({ ...input({ pairs: broken }), pairs: broken }, players, NOW),
      'POINTS_MISMATCH',
    );
    expect(error.issues.map((i) => i.path)).toEqual([
      'pairs[1].totalPoints',
      'pairs[4].totalPoints',
    ]);
  });

  it('rejects the same player appearing in two pairs', () => {
    const { pairs, players } = pairsWithPlayers(6);
    const duplicated = pairs.map((pair, index) =>
      index === 3 ? { ...pair, players: [pairs[0]!.players[0], pair.players[1]] as const } : pair,
    );

    const error = expectDomainError(
      () =>
        deriveLineup(
          { ...input({ pairs: [...duplicated] }), pairs: [...duplicated] },
          players,
          NOW,
        ),
      'DUPLICATE_PLAYER',
    );
    // Substituting the player also changes that pair's total, so a POINTS_MISMATCH issue is raised
    // as well — which is the point of FR-005. Assert the duplicate is reported, not that it is first.
    expect(error.issues.map((i) => i.message).join('\n')).toContain(pairs[0]!.players[0].name);
  });

  it('rejects the same player twice inside one pair', () => {
    const { pairs, players } = pairsWithPlayers(6);
    const selfPaired = pairs.map((pair, index) =>
      index === 0 ? { ...pair, players: [pair.players[0], pair.players[0]] as const } : pair,
    );

    expectDomainError(
      () =>
        deriveLineup(
          { ...input({ pairs: [...selfPaired] }), pairs: [...selfPaired] },
          players,
          NOW,
        ),
      'DUPLICATE_PLAYER',
    );
  });

  it('rejects a start instant that is not in the future', () => {
    const { pairs, players } = pairsWithPlayers(6);
    expectDomainError(
      () =>
        deriveLineup(
          { ...input({ pairs }), pairs, startsAt: '2026-08-01T10:00:00.000Z' },
          players,
          NOW,
        ),
      'START_NOT_IN_FUTURE',
    );
  });

  it('rejects a start instant exactly equal to now', () => {
    // The boundary: a tournament starting this instant is already closed to voting (FR-011).
    const { pairs, players } = pairsWithPlayers(6);
    expectDomainError(
      () => deriveLineup({ ...input({ pairs }), pairs, startsAt: NOW.toISOString() }, players, NOW),
      'START_NOT_IN_FUTURE',
    );
  });

  it('rejects an unparseable start instant', () => {
    const { pairs, players } = pairsWithPlayers(6);
    expectDomainError(
      () => deriveLineup({ ...input({ pairs }), pairs, startsAt: 'not-a-date' }, players, NOW),
      'MALFORMED_PAYLOAD',
    );
  });

  it('rejects unresolved players, naming each offending entry with its path', () => {
    const { pairs, players } = pairsWithPlayers(6);
    const typo = pairs.map((pair, index) =>
      index === 1
        ? {
            ...pair,
            players: [
              { ...pair.players[0], name: 'Nome Que Nao Existe' },
              pair.players[1],
            ] as const,
          }
        : pair,
    );

    const error = expectDomainError(
      () => deriveLineup({ ...input({ pairs: [...typo] }), pairs: [...typo] }, players, NOW),
      'UNRESOLVED_PLAYERS',
    );
    expect(error.issues[0]?.path).toBe('pairs[1].players[0].name');
    expect(error.issues[0]?.message).toContain('Nome Que Nao Existe');
  });

  it('rejects a colliding match key in the known players', () => {
    const { pairs, players } = pairsWithPlayers(6);
    const collided = [
      ...players,
      {
        ...players[0]!,
        id: 'ffffffff-0000-4000-8000-000000000001' as PlayerId,
        externalId: 99_999 as ExternalPlayerId,
      },
    ];

    expectDomainError(
      () => deriveLineup({ ...input({ pairs }), pairs }, collided, NOW),
      'DUPLICATE_MATCH_KEY',
    );
  });

  it('reports problems from different rules together (FR-005)', () => {
    const { pairs, players } = pairsWithPlayers(6);
    const broken = pairs.map((pair, index) => {
      if (index === 0) return { ...pair, totalPoints: 1 };
      if (index === 1) {
        return {
          ...pair,
          players: [{ ...pair.players[0], name: 'Nome Que Nao Existe' }, pair.players[1]] as const,
        };
      }
      return pair;
    });

    let caught: DomainError | undefined;
    try {
      deriveLineup({ ...input({ pairs: [...broken] }), pairs: [...broken] }, players, NOW);
    } catch (error) {
      caught = error as DomainError;
    }

    expect(caught).toBeInstanceOf(DomainError);
    const paths = caught!.issues.map((i) => i.path);
    expect(paths).toContain('pairs[0].totalPoints');
    expect(paths).toContain('pairs[1].players[0].name');
  });
});

describe('deriveLineup — output', () => {
  it('derives a slug from the name when none is given', () => {
    const { pairs, players } = pairsWithPlayers(6);
    const result = deriveLineup(
      { ...input({ pairs }), pairs, name: 'Torneio de Exemplo — 12 Setembro' },
      players,
      NOW,
    );
    expect(result.slug).toBe('torneio-de-exemplo-12-setembro');
  });

  it('keeps an explicit slug', () => {
    const { pairs, players } = pairsWithPlayers(6);
    const result = deriveLineup(
      { ...input({ pairs }), pairs, slug: 'endereco-escolhido' },
      players,
      NOW,
    );
    expect(result.slug).toBe('endereco-escolhido');
  });

  it('rejects a name that produces an empty slug', () => {
    const { pairs, players } = pairsWithPlayers(6);
    expectDomainError(
      () => deriveLineup({ ...input({ pairs }), pairs, name: '—— ——' }, players, NOW),
      'MALFORMED_PAYLOAD',
    );
  });

  it('captures each player’s points and resolved identity on the pair', () => {
    const { pairs, players } = pairsWithPlayers(6);
    const result = deriveLineup({ ...input({ pairs }), pairs }, players, NOW);

    const first = result.groups[0]!.pairs[0]!;
    expect(first.members[0].points).toBe(pairs[0]!.players[0].points);
    expect(first.members[0].playerId).toBe(players[0]!.id);
    expect(first.club).toBe('Clube Fictício');
  });

  it('lists every resolved player once per lineup slot, in payload order', () => {
    const { pairs, players } = pairsWithPlayers(6);
    const result = deriveLineup({ ...input({ pairs }), pairs }, players, NOW);

    expect(result.resolvedPlayers).toHaveLength(12);
    expect(result.resolvedPlayers[0]?.inputName).toBe(pairs[0]!.players[0].name);
  });

  it('returns the start instant as a Date', () => {
    const { pairs, players } = pairsWithPlayers(6);
    const result = deriveLineup({ ...input({ pairs }), pairs }, players, NOW);
    expect(result.startsAt.toISOString()).toBe(FUTURE);
  });
});
