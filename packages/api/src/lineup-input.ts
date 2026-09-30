import type { LineupPayload } from '@padelmigas/contracts';
import { deriveLineup, toMatchKey, type DerivedLineup, type LineupInput } from '@padelmigas/core';
import type { Deps } from './handler.js';

/**
 * Wire payload → derived lineup, shared by preview, publish and replace (FR-001 – FR-005).
 *
 * Every path that turns a pasted lineup into a tournament goes through here, so a replacement is
 * validated by exactly the rules a new lineup is (feature 003, FR-202).
 */
export function toLineupInput(payload: LineupPayload): LineupInput {
  return {
    name: payload.name,
    ...(payload.slug === undefined ? {} : { slug: payload.slug }),
    startsAt: payload.startsAt,
    pairs: payload.pairs.map((pair) => ({
      club: pair.club,
      totalPoints: pair.totalPoints,
      ...(pair.group === undefined ? {} : { group: pair.group }),
      players: [
        { name: pair.players[0].name, points: pair.players[0].points },
        { name: pair.players[1].name, points: pair.players[1].points },
      ],
    })),
  };
}

/**
 * Resolves the payload's players and derives the lineup.
 *
 * Loads only the players this payload could refer to. Only the name route exists: since the
 * 2026-08-28 amendment a payload cannot carry an explicit ranking id, because the sheet reuses ids
 * across different people (FR-004, ADR-007 § Amendment).
 */
export async function deriveFromPayload(
  input: LineupInput,
  deps: Deps,
  now: Date,
): Promise<DerivedLineup> {
  const matchKeys = [
    ...new Set(input.pairs.flatMap((pair) => pair.players.map((p) => toMatchKey(p.name)))),
  ].filter((key) => key.length > 0);
  const known = await deps.players.findByMatchKeys(matchKeys);
  return deriveLineup(input, known, now);
}
