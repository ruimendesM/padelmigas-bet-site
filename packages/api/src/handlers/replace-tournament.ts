import type {
  LineupPayload,
  PublishRequest,
  ReplacementPreviewDto,
  TournamentDetailDto,
} from '@padelmigas/contracts';
import {
  domainError,
  isVotingOpen,
  planCarryOver,
  type CarryOverDecision,
  type DerivedLineup,
  type TournamentWithGroups,
} from '@padelmigas/core';
import type { Deps } from '../handler.js';
import { deriveFromPayload, toLineupInput } from '../lineup-input.js';
import { toGroupDto, toTournamentSummaryDto } from '../views.js';
import { toLineupPreviewDto } from './preview-lineup.js';
import { toPublication } from './publish-tournament.js';

/**
 * Replacing an open tournament with a corrected lineup (feature 003, FR-201 – FR-210).
 *
 * Preview and confirm share one derivation, as preview and publish do: the confirm step re-derives
 * everything rather than trusting what the preview returned (Principle IV). The carry-over decision
 * is made here, by `core/replacement`, and the repository only executes it.
 *
 * The replacement always takes the original's slug (FR-210); a `slug` in the payload is ignored.
 */

export interface ReplaceInput<TBody> {
  /** The tournament being replaced, as addressed today. */
  readonly slug: string;
  readonly body: TBody;
}

interface Prepared {
  readonly original: TournamentWithGroups;
  readonly derived: DerivedLineup;
  readonly carryOver: readonly CarryOverDecision[];
  readonly now: Date;
}

async function prepare(input: ReplaceInput<LineupPayload>, deps: Deps): Promise<Prepared> {
  const original = await deps.tournaments.findBySlug(input.slug);
  if (!original || original.publishedAt === null) {
    throw domainError('NOT_FOUND', 'Torneio não encontrado.');
  }

  const now = deps.clock.now();
  // An invalidated tournament is closed to `core/window`, so one check covers both cases FR-201
  // excludes: voting has closed, or it was already replaced.
  if (!isVotingOpen(original, now)) {
    throw domainError(
      'NOT_REPLACEABLE',
      'Só é possível substituir um torneio com a votação ainda aberta.',
    );
  }

  const derived = await deriveFromPayload(
    { ...toLineupInput(input.body), slug: original.slug },
    deps,
    now,
  );

  const carryOver = planCarryOver(
    original.groups,
    derived.groups.map((group) => ({ label: group.label, pairs: group.pairs })),
  );

  return { original, derived, carryOver, now };
}

export async function previewReplacement(
  input: ReplaceInput<LineupPayload>,
  deps: Deps,
): Promise<ReplacementPreviewDto> {
  const { original, derived, carryOver } = await prepare(input, deps);

  const carriedGroupIds = carryOver.flatMap((decision) =>
    decision.carriedFrom === null ? [] : [decision.carriedFrom.groupId],
  );
  // Organiser-only: the per-group counts are what lets them judge the correction (FR-203), and the
  // organiser is not a voter.
  const counts = await deps.results.countsForGroups(carriedGroupIds);

  const preview = toLineupPreviewDto(derived);
  return {
    ...preview,
    replaces: { id: original.id, slug: original.slug, name: original.name },
    groups: preview.groups.map((group, index) => {
      const carriedFrom = carryOver[index]?.carriedFrom ?? null;
      return {
        ...group,
        carryOver:
          carriedFrom === null
            ? { keepsVotes: false, ballotCount: 0 }
            : {
                keepsVotes: true,
                ballotCount: counts.get(carriedFrom.groupId)?.ballotCount ?? 0,
              },
      };
    }),
  };
}

export async function replaceTournament(
  input: ReplaceInput<PublishRequest>,
  deps: Deps,
): Promise<TournamentDetailDto> {
  // As for publishing: the rule is a product decision, stated where it is enforced (FR-203).
  if (input.body.confirm !== true) {
    throw domainError('NOT_CONFIRMED', 'A substituição tem de ser confirmada explicitamente.', [
      { path: 'confirm', message: 'Confirma a substituição para continuar.' },
    ]);
  }

  const { original, derived, carryOver, now } = await prepare(input, deps);

  const outcome = await deps.tournaments.replace({
    originalId: original.id,
    publication: toPublication(derived, now),
    carryOver,
    now,
  });

  // Closed or replaced by someone else between our read and the repository's lock (FR-205).
  if (outcome.kind === 'not-replaceable') {
    throw domainError(
      'NOT_REPLACEABLE',
      'Este torneio já não pode ser substituído: a votação fechou ou já foi substituído.',
    );
  }

  const replacement = outcome.tournament;
  const counts = await deps.results.countsForGroups(replacement.groups.map((group) => group.id));
  const votingOpen = isVotingOpen(replacement, now);

  return {
    ...toTournamentSummaryDto(replacement, {
      groupCount: replacement.groups.length,
      // Carried-over ballots already count here (FR-207).
      ballotCount: [...counts.values()].reduce((total, c) => total + c.ballotCount, 0),
      now,
    }),
    groups: replacement.groups.map((group) =>
      // The organiser is not a voter here: no ballot and no results, as for a publish.
      toGroupDto(group, { hasVoted: false, votingOpen, ownBallot: null, results: null }),
    ),
  };
}
