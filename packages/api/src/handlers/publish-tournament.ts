import type { PublishRequest, TournamentDetailDto } from '@padelmigas/contracts';
import {
  deriveLineup,
  domainError,
  isVotingOpen,
  toMatchKey,
  type LineupInput,
} from '@padelmigas/core';
import type { Handler } from '../handler.js';
import { toGroupDto, toTournamentSummaryDto } from '../views.js';

/**
 * Publishes a previewed lineup (FR-002, FR-006, FR-007).
 *
 * The whole payload is re-derived here rather than trusting anything the preview returned: the
 * preview is advisory and the client could have edited the pairs between the two calls (Principle
 * IV). Deriving twice is cheap; publishing an unvalidated lineup to a public page is not (Risk R9).
 *
 * Points are captured now, at publish time, and never rewritten by a later ranking sync — `pairs`
 * stores them per player so a tournament page always shows what was true on the day (FR-007).
 */
export const publishTournament: Handler<PublishRequest, TournamentDetailDto> = async (
  payload,
  deps,
) => {
  // Zod's `z.literal(true)` already rejects `confirm: false`, but the rule is a product decision
  // ("no paste-and-publish", FR-002) rather than a shape, so it is stated where it is enforced.
  if (payload.confirm !== true) {
    throw domainError('NOT_CONFIRMED', 'A publicação tem de ser confirmada explicitamente.', [
      { path: 'confirm', message: 'Confirma a publicação para continuar.' },
    ]);
  }

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
  const known = [...new Map([...byName, ...byId].map((p) => [p.id, p])).values()];

  const now = deps.clock.now();
  const derived = deriveLineup(input, known, now);

  // Checked before the insert so the organiser gets `SLUG_TAKEN` rather than a unique-violation 500.
  // The insert is still the authority — two publishes racing on the same slug are settled by the
  // constraint, which the repository surfaces as the same code.
  if (await deps.tournaments.slugExists(derived.slug)) {
    throw domainError('SLUG_TAKEN', `Já existe um torneio com o endereço "${derived.slug}".`, [
      { path: 'slug', message: `O endereço "${derived.slug}" já está em uso.` },
    ]);
  }

  const published = await deps.tournaments.publish({
    name: derived.name,
    slug: derived.slug,
    startsAt: derived.startsAt,
    publishedAt: now,
    groups: derived.groups.map((group) => ({
      label: group.label,
      position: group.position,
      pairs: group.pairs.map((pair) => ({
        club: pair.club,
        seed: pair.seed,
        totalPoints: pair.totalPoints,
        members: [
          { playerId: pair.members[0].playerId, points: pair.members[0].points },
          { playerId: pair.members[1].playerId, points: pair.members[1].points },
        ],
      })),
    })),
  });

  const votingOpen = isVotingOpen(published, now);

  return {
    ...toTournamentSummaryDto(published, {
      groupCount: published.groups.length,
      // Freshly published: no ballot can exist yet, so this is 0 by construction rather than by query.
      ballotCount: 0,
      now,
    }),
    groups: published.groups.map((group) =>
      // The organiser is not a voter here: no ballot, and no results to reveal on a new tournament.
      toGroupDto(group, { hasVoted: false, votingOpen, ownBallot: null, results: null }),
    ),
  };
};
