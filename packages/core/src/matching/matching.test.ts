import { describe, expect, it } from 'vitest';
import type { ExternalPlayerId, PlayerId } from '@padelmigas/contracts';
import type { Player } from '../domain/index.js';
import { resolvePlayers, toMatchKey } from './index.js';

/**
 * Name normalisation and player resolution (FR-004, SC-003, ADR-007).
 *
 * These tests carry a 100% branch requirement because a wrong answer here silently attributes a
 * tournament to the wrong person — the failure ADR-007 exists to prevent. The empirical basis is
 * research F2: 783 ranking rows, 0 duplicate names, 24/24 lineup names matching after case folding.
 */

function player(overrides: Partial<Player> & { matchKey: string }): Player {
  return {
    id: `00000000-0000-4000-8000-${String(overrides.externalId ?? 1).padStart(12, '0')}` as PlayerId,
    externalId: (overrides.externalId ?? 1) as ExternalPlayerId,
    displayName: overrides.displayName ?? 'Nome Fictício',
    matchKey: overrides.matchKey,
    club: overrides.club ?? null,
  };
}

describe('toMatchKey', () => {
  it('lower-cases so a lineup and the sheet agree on particle capitalisation', () => {
    // The single real mismatch found in research F2 was exactly this.
    expect(toMatchKey('Rodrigo da Costa')).toBe(toMatchKey('Rodrigo Da Costa'));
  });

  it('composes to NFC so decomposed and precomposed accents match', () => {
    // "Duarte Vilaça" written with a combining cedilla vs. the precomposed character.
    const decomposed = 'Duarte Vilaça';
    const precomposed = 'Duarte Vilaça';
    expect(decomposed).not.toBe(precomposed);
    expect(toMatchKey(decomposed)).toBe(toMatchKey(precomposed));
  });

  it('collapses internal whitespace runs and trims the ends', () => {
    expect(toMatchKey('  Xavier   Lourenço \t')).toBe(toMatchKey('Xavier Lourenço'));
  });

  it('treats non-breaking space as whitespace', () => {
    // Spreadsheet exports produce these; a lineup pasted from a document does too.
    expect(toMatchKey('Simão Anjos')).toBe(toMatchKey('Simão Anjos'));
  });

  it('preserves accents rather than stripping them', () => {
    // Stripping would collapse two genuinely different names, which is worse than a loud miss.
    expect(toMatchKey('Simão')).not.toBe(toMatchKey('Simao'));
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(toMatchKey('   ')).toBe('');
  });
});

describe('resolvePlayers', () => {
  const known = [
    player({ externalId: 114, displayName: 'Rodrigo Da Costa', matchKey: 'rodrigo da costa' }),
    player({ externalId: 105, displayName: 'Duarte Vilaça', matchKey: 'duarte vilaça' }),
  ];

  it('resolves a name that differs only in case', () => {
    const result = resolvePlayers([{ name: 'Rodrigo da Costa', points: 443 }], known);

    expect(result.unresolved).toEqual([]);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]).toMatchObject({
      inputName: 'Rodrigo da Costa',
      externalId: 114,
      displayName: 'Rodrigo Da Costa',
      isNew: false,
    });
  });

  it('reports an unmatched name instead of creating a player', () => {
    // FR-004: unmatched names must fail loudly and be resolved by a human.
    const result = resolvePlayers([{ name: 'Rodrigo da Costaa', points: 443 }], known);

    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([{ index: 0, name: 'Rodrigo da Costaa' }]);
  });

  it('reports every unmatched name, not just the first (FR-005)', () => {
    const result = resolvePlayers(
      [
        { name: 'Nome Inexistente Um', points: 1 },
        { name: 'Duarte Vilaça', points: 2 },
        { name: 'Nome Inexistente Dois', points: 3 },
      ],
      known,
    );

    expect(result.unresolved.map((u) => u.index)).toEqual([0, 2]);
  });

  it('resolves by name alone, with no explicit-id escape hatch', () => {
    // The disambiguation path was retired on 2026-08-28 (FR-004, ADR-007 § Amendment): it resolved
    // ties through `external_id`, and the ranking sheet reuses ids across different people, so an
    // explicit id could select the wrong person outright. A name that is not on the list is now
    // simply unresolved -- there is no second route by which it could come back.
    const result = resolvePlayers([{ name: 'Qualquer Nome Diferente', points: 443 }], known);

    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([{ index: 0, name: 'Qualquer Nome Diferente' }]);
  });

  it('rejects the whole set when two known players share a match key', () => {
    // Uniqueness is a property of today's data, not a guarantee (research F2). The check runs every
    // time, and the caller must not proceed on a guess (ADR-007).
    const colliding = [
      player({ externalId: 1, displayName: 'Ana Silva', matchKey: 'ana silva' }),
      player({ externalId: 2, displayName: 'ANA SILVA', matchKey: 'ana silva' }),
    ];

    const result = resolvePlayers([{ name: 'Ana Silva', points: 1 }], colliding);

    expect(result.resolved).toEqual([]);
    expect(result.ambiguous).toEqual([{ matchKey: 'ana silva', externalIds: [1, 2] }]);
  });

  it('reports an input name that normalises to nothing', () => {
    const result = resolvePlayers([{ name: '   ', points: 1 }], known);
    expect(result.unresolved).toEqual([{ index: 0, name: '   ' }]);
  });

  it('resolves the same player named twice without duplicating the resolution', () => {
    // The lineup rule "a player appears at most once per tournament" is enforced in core/lineup;
    // matching's job is only to say who each name is, once per name.
    const result = resolvePlayers(
      [
        { name: 'Duarte Vilaça', points: 495 },
        { name: 'duarte vilaça', points: 495 },
      ],
      known,
    );

    expect(result.unresolved).toEqual([]);
    expect(result.resolved).toHaveLength(2);
    expect(result.resolved.map((r) => r.externalId)).toEqual([105, 105]);
  });

  it('returns an empty result for an empty input', () => {
    const result = resolvePlayers([], known);
    expect(result).toEqual({ resolved: [], unresolved: [], ambiguous: [] });
  });
});
