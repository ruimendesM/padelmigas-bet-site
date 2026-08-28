import { formatPairName, type GroupResultsState } from '@padelmigas/ui-logic';
import type { PairDto } from '@padelmigas/contracts';
import { t } from '../src/i18n/index.js';
import { EmptyState } from './states/index.js';

/**
 * The crowd's predicted standings for one group (FR-017, FR-019).
 *
 * Presentational only: it renders whichever of the three states `resultsStateFor` decided. It never
 * decides the reveal itself — that lives in `core/reveal`, server-side, and a component that could
 * re-decide it would be a second place for Risk R1 to hide.
 *
 * The ballot count is always visible next to the percentages. At club sample sizes "60 %" means
 * something very different at N=5 than at N=50, and hiding N would make the crowd look more certain
 * than it is (Risk R6).
 */
export function GroupResults({
  state,
  pairs,
}: {
  state: GroupResultsState;
  pairs: readonly PairDto[];
}) {
  if (state.kind === 'hidden') {
    return <EmptyState message={t.results.hidden} />;
  }
  if (state.kind === 'empty') {
    return <EmptyState message={t.results.noVotes} />;
  }

  const { view } = state;
  const nameFor = (pairId: string): string => {
    const pair = pairs.find((candidate) => candidate.id === pairId);
    return pair ? formatPairName(pair.players) : pairId;
  };

  return (
    <section aria-label={t.results.heading} className="mt-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">{t.results.heading}</h4>
        <p className="text-ink-muted text-xs">{t.results.ballotCount(view.ballotCount)}</p>
      </div>

      <ol className="space-y-3">
        {view.standings.map((standing) => (
          <li key={standing.pairId} className="bg-surface border-border rounded-lg border p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium">
                <span className="text-accent tabular-nums">{standing.predictedPosition}.</span>{' '}
                {nameFor(standing.pairId)}
              </p>
              <p className="text-ink-muted whitespace-nowrap text-xs">
                {t.results.meanPosition}: {standing.meanPositionLabel}
              </p>
            </div>

            <ul className="mt-2 space-y-1" aria-label={t.results.positionSharesHeading}>
              {standing.positionShares.map((share) => (
                <li key={share.position} className="flex items-center gap-2">
                  <span className="text-ink-muted w-8 shrink-0 text-xs tabular-nums">
                    {share.position}.º
                  </span>
                  {/* The bar uses the unrounded share; only the label is rounded (SC-004). */}
                  <span
                    aria-hidden="true"
                    className="bg-surface-muted h-2 flex-1 overflow-hidden rounded-full"
                  >
                    <span
                      className="bg-accent block h-full rounded-full"
                      style={{ width: `${share.share * 100}%` }}
                    />
                  </span>
                  <span className="w-12 shrink-0 text-right text-xs tabular-nums">
                    {share.label}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
