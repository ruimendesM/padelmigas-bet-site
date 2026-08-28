import type { PlayerDetailDto } from '@padelmigas/contracts';
import type { PlayerId } from '@padelmigas/contracts/common';
import { domainError, publicStatusAt } from '@padelmigas/core';
import type { Handler } from '../handler.js';

/**
 * A player and every tournament they played (FR-025, SC-008).
 *
 * One record per real person: appearances are joined through `pairs`, so a player who played four
 * tournaments has one document with four entries rather than four documents — which is what makes a
 * duplicate identity visible instead of invisible (ADR-007).
 *
 * Nothing here is voter-dependent and nothing carries a group's ordering: an appearance names the
 * tournament, the group label and the partner, never a result (SC-006).
 */
export const getPlayer: Handler<{ playerId: PlayerId }, PlayerDetailDto> = async (input, deps) => {
  const player = await deps.players.findById(input.playerId);
  if (!player) throw domainError('NOT_FOUND', 'Jogador não encontrado.');

  const [appearances, latestPoints] = await Promise.all([
    deps.history.appearancesFor(input.playerId),
    deps.ratings.latestPointsFor([input.playerId]),
  ]);

  const now = deps.clock.now();

  return {
    id: player.id,
    externalId: player.externalId,
    name: player.displayName,
    club: player.club,
    currentPoints: latestPoints.get(input.playerId) ?? null,
    appearances: appearances.flatMap((appearance) => {
      const status = publicStatusAt(appearance.tournament, now);
      // A draft appearance cannot be public. `flatMap` drops it rather than the serialiser throwing:
      // one unpublished tournament must not take a player's whole history down with it.
      if (status === null) return [];
      return [
        {
          tournament: {
            id: appearance.tournament.id,
            slug: appearance.tournament.slug,
            name: appearance.tournament.name,
            startsAt: appearance.tournament.startsAt.toISOString(),
            status,
            groupCount: appearance.groupCount,
            ballotCount: appearance.ballotCount,
          },
          groupLabel: appearance.groupLabel,
          partner: { id: appearance.partner.id, name: appearance.partner.name },
          pointsAtTournament: appearance.pointsAtTournament,
        },
      ];
    }),
  };
};
