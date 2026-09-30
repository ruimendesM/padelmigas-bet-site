import type { LineupPayload, LineupPreviewDto } from '@padelmigas/contracts';
import { domainError, type DerivedLineup } from '@padelmigas/core';
import type { Handler } from '../handler.js';
import { deriveFromPayload, toLineupInput } from '../lineup-input.js';

/**
 * Validates a pasted lineup and returns the derived tournament **without persisting it** (FR-002).
 *
 * The preview is mandatory before publishing because Risk R9 — an organiser publishing the wrong
 * start time or a mis-typed lineup to a public page — has no cheap undo. Everything this returns is
 * computed from the payload plus the already-imported ranking identities; nothing is written.
 */
export const previewLineup: Handler<LineupPayload, LineupPreviewDto> = async (payload, deps) => {
  const derived = await deriveFromPayload(toLineupInput(payload), deps, deps.clock.now());

  // A taken slug is reported at preview time so the organiser fixes it before the publish step,
  // rather than losing a confirmed publish to a 409.
  if (await deps.tournaments.slugExists(derived.slug)) {
    throw domainError('SLUG_TAKEN', `Já existe um torneio com o endereço "${derived.slug}".`, [
      { path: 'slug', message: `O endereço "${derived.slug}" já está em uso.` },
    ]);
  }

  return toLineupPreviewDto(derived);
};

/** Derived lineup → preview wire shape. Shared with the replacement preview (feature 003). */
export function toLineupPreviewDto(derived: DerivedLineup): LineupPreviewDto {
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
}
