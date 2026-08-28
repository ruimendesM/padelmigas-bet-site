import type { GroupResultsDto } from '@padelmigas/contracts';
import { formatMeanPosition, formatShare, DEFAULT_LOCALE } from './format.js';

/**
 * Results presentation (FR-017, FR-019).
 *
 * Turns the unrounded wire shape into strings a view renders directly. Rounding happens **here and
 * nowhere earlier**: `core/scoring` orders on exact values, and a percentage rounded before ordering
 * would let two pairs tie on screen and then sort differently between reloads (SC-004).
 *
 * The "no votes" state is explicit rather than a zeroed table. A results object never describes zero
 * ballots — it is omitted instead — so a view has two distinct cases to render, not one ambiguous
 * one (FR-019, contracts/README rule 2).
 */

export interface PositionShareView {
  readonly position: number;
  readonly votes: number;
  /** The unrounded share, kept for a bar's width — rounding a width loses information for free. */
  readonly share: number;
  /** `62 %` — rounded, for the label. */
  readonly label: string;
}

export interface StandingView {
  readonly pairId: string;
  readonly predictedPosition: number;
  readonly meanPositionLabel: string;
  readonly positionShares: readonly PositionShareView[];
  /** The pair's strongest position, for the one-line summary on a narrow screen. */
  readonly topShare: PositionShareView | null;
}

export interface ResultsView {
  readonly groupId: string;
  readonly ballotCount: number;
  readonly standings: readonly StandingView[];
}

export function toResultsView(
  results: GroupResultsDto,
  locale: string = DEFAULT_LOCALE,
): ResultsView {
  return {
    groupId: results.groupId,
    ballotCount: results.ballotCount,
    standings: results.standings.map((standing) => {
      const positionShares = standing.positionShares.map((share) => ({
        position: share.position,
        votes: share.votes,
        share: share.share,
        label: formatShare(share.share, { locale }),
      }));
      // Ties resolve to the earliest position, which reads as the more confident claim.
      const topShare = positionShares.reduce<PositionShareView | null>(
        (best, candidate) => (best === null || candidate.share > best.share ? candidate : best),
        null,
      );
      return {
        pairId: standing.pairId,
        predictedPosition: standing.predictedPosition,
        meanPositionLabel: formatMeanPosition(standing.meanPosition, locale),
        positionShares,
        ...(topShare === null ? { topShare: null } : { topShare }),
      };
    }),
  };
}

/**
 * What a view should render for a group.
 *
 * Three states, named, so a component cannot accidentally collapse "you have not earned this" into
 * "nobody voted" — they mean opposite things to a voter (FR-019, FR-020).
 */
export type GroupResultsState =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'results'; readonly view: ResultsView };

export function resultsStateFor(
  options: { readonly revealed: boolean; readonly results: GroupResultsDto | null | undefined },
  locale: string = DEFAULT_LOCALE,
): GroupResultsState {
  if (!options.revealed) return { kind: 'hidden' };
  // Revealed with nothing to show: voting closed and nobody voted.
  if (!options.results) return { kind: 'empty' };
  return { kind: 'results', view: toResultsView(options.results, locale) };
}
