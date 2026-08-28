import { describe, expect, it } from 'vitest';
import type { GroupResultsDto } from '@padelmigas/contracts';
import { resultsStateFor, toResultsView } from './results.js';

/**
 * Results presentation (FR-017, FR-019, SC-004).
 *
 * The property worth protecting is that rounding is a *label*: the unrounded share survives into the
 * view for the bar width, and only the string is rounded.
 */

const results = {
  groupId: '00000000-0000-4000-8000-0000000000aa',
  ballotCount: 3,
  standings: [
    {
      pairId: '00000000-0000-4000-8000-000000000001',
      predictedPosition: 1,
      meanPosition: 1.3333333333333333,
      positionShares: [
        { position: 1, votes: 2, share: 2 / 3 },
        { position: 2, votes: 1, share: 1 / 3 },
        { position: 3, votes: 0, share: 0 },
      ],
    },
  ],
} as unknown as GroupResultsDto;

describe('toResultsView', () => {
  it('rounds only the label and keeps the exact share for the bar', () => {
    const view = toResultsView(results, 'pt-PT');
    const share = view.standings[0]?.positionShares[0];
    expect(share?.share).toBe(2 / 3);
    expect(share?.label).toMatch(/67\s*%/);
  });

  it('formats the mean position to two decimals', () => {
    const view = toResultsView(results, 'pt-PT');
    expect(view.standings[0]?.meanPositionLabel).toMatch(/1[.,]33/);
  });

  it('names the strongest position, resolving a tie to the earliest', () => {
    const tied = {
      ...results,
      standings: [
        {
          ...results.standings[0],
          positionShares: [
            { position: 1, votes: 1, share: 0.5 },
            { position: 2, votes: 1, share: 0.5 },
          ],
        },
      ],
    } as unknown as GroupResultsDto;
    expect(toResultsView(tied).standings[0]?.topShare?.position).toBe(1);
  });
});

describe('resultsStateFor', () => {
  it('is hidden when the caller has not earned the reveal', () => {
    // Distinct from "empty": one means "vote to see", the other means "nobody voted" (FR-019).
    expect(resultsStateFor({ revealed: false, results })).toEqual({ kind: 'hidden' });
  });

  it('is empty when revealed with no results object', () => {
    expect(resultsStateFor({ revealed: true, results: null })).toEqual({ kind: 'empty' });
    expect(resultsStateFor({ revealed: true, results: undefined })).toEqual({ kind: 'empty' });
  });

  it('carries the view when revealed with results', () => {
    const state = resultsStateFor({ revealed: true, results });
    expect(state.kind).toBe('results');
    if (state.kind === 'results') expect(state.view.ballotCount).toBe(3);
  });
});
