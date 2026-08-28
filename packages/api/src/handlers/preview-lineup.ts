import type { LineupPayload, LineupPreviewDto } from '@padelmigas/contracts';
import { deriveLineup, domainError, toMatchKey, type LineupInput } from '@padelmigas/core';
import type { Handler } from '../handler.js';

/**
 * Validates a pasted lineup and returns the derived tournament **without persisting it** (FR-002).
 *
 * The preview is mandatory before publishing because Risk R9 — an organiser publishing the wrong
 * start time or a mis-typed lineup to a public page — has no cheap undo. Everything this returns is
 * computed from the payload plus the already-imported ranking identities; nothing is written.
 */
export const previewLineup: Handler<LineupPayload, LineupPreviewDto> = async (payload, deps) => {
  const input: LineupInput = {
    name: payload.name,
    ...(payload.slug === undefined ? {} : { slug: payload.slug }),
    startsAt: payload.startsAt,
    pairs: payload.pairs.map((pair) => ({
      club: pair.club,
      totalPoints: pair.totalPoints,
      ...(pair.group === undefined ? {} : { group: pair.group }),
      players: [
        {
          name: pair.players[0].name,
          points: pair.players[0].points,
          ...(pair.players[0].externalId === undefined
            ? {}
            : { externalId: pair.players[0].externalId }),
        },
        {
          name: pair.players[1].name,
          points: pair.players[1].points,
          ...(pair.players[1].externalId === undefined
            ? {}
            : { externalId: pair.players[1].externalId }),
        },
      ],
    })),
  };

  // Load only the players this payload could refer to. Loading the whole ranking list (≈783 rows)
  // would work but makes the ambiguity check scan people the lineup never mentions.
  const matchKeys = [
    ...new Set(input.pairs.flatMap((pair) => pair.players.map((p) => toMatchKey(p.name)))),
  ].filter((key) => key.length > 0);
  const externalIds = [
    ...new Set(
      input.pairs
        .flatMap((pair) => pair.players.map((p) => p.externalId))
        .filter((id): id is NonNullable<typeof id> => id !== undefined),
    ),
  ];

  const [byName, byId] = await Promise.all([
    deps.players.findByMatchKeys(matchKeys),
    deps.players.findByExternalIds(externalIds),
  ]);

  // Union by id: a player may be reachable by both routes and must not appear twice, which would
  // otherwise register as an ambiguous match key.
  const known = [...new Map([...byName, ...byId].map((p) => [p.id, p])).values()];

  const derived = deriveLineup(input, known, deps.clock.now());

  // A taken slug is reported at preview time so the organiser fixes it before the publish step,
  // rather than losing a confirmed publish to a 409.
  if (await deps.tournaments.slugExists(derived.slug)) {
    throw domainError('SLUG_TAKEN', `Já existe um torneio com o endereço "${derived.slug}".`, [
      { path: 'slug', message: `O endereço "${derived.slug}" já está em uso.` },
    ]);
  }

  return {
    name: derived.name,
    slug: derived.slug,
    startsAt: derived.startsAt.toISOString(),
    groups: derived.groups.map((group) => ({
      label: group.label,
      pairs: group.pairs.map((pair) => ({
        // A preview has no persisted pair, so the id is the payload position it came from. It is
        // never used as a key against the database — publishing derives fresh ids.
        id: `00000000-0000-4000-8000-${String(pair.sourceIndex).padStart(12, '0')}`,
        seed: pair.seed,
        club: pair.club,
        totalPoints: pair.totalPoints,
        players: [
          {
            id: pair.members[0].playerId,
            name: pair.members[0].displayName,
            points: pair.members[0].points,
          },
          {
            id: pair.members[1].playerId,
            name: pair.members[1].displayName,
            points: pair.members[1].points,
          },
        ],
      })),
    })),
    resolvedPlayers: derived.resolvedPlayers.map((resolved) => ({
      inputName: resolved.inputName,
      externalId: resolved.externalId,
      displayName: resolved.displayName,
      isNew: resolved.isNew,
    })),
  } as LineupPreviewDto;
};
