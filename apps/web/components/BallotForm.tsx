'use client';

import { useReducer, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GroupDto } from '@padelmigas/contracts';
import {
  ballotReducer,
  createDraft,
  formatPairName,
  isComplete,
  pairAt,
  positionOf,
  remainingCount,
  toSubmission,
} from '@padelmigas/ui-logic';
import { t } from '../src/i18n/index.js';

/**
 * The voting form for one group (FR-009, FR-010, SC-002, SC-011).
 *
 * **One tap per position.** Each pair carries a row of position buttons; tapping one assigns it and
 * swaps whoever held it. There is no drag, no long-press and no reordering gesture: the target is a
 * first-time voter on a phone finishing in under a minute, and drag-and-drop is the least reliable
 * interaction on a small screen (SC-002, research D8).
 *
 * Accessibility is part of the mechanism rather than a later pass: the buttons are real buttons, so
 * keyboard assignment works with no extra code, each is labelled with both the pair and the position
 * it would assign, and the recorded vote is announced in a live region (SC-011).
 *
 * All validation here is a convenience. The server re-decides every rule against the group's real
 * membership (Principle IV) — this exists to disable a button, not to protect the aggregate.
 */
export function BallotForm({ group }: { group: GroupDto }) {
  const router = useRouter();
  const [draft, dispatch] = useReducer(
    ballotReducer,
    group.pairs.map((pair) => pair.id),
    createDraft,
  );
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const positions = group.pairs.map((_, index) => index + 1);
  const complete = isComplete(draft);

  async function submit(): Promise<void> {
    const submission = toSubmission(draft);
    if (!submission) return;

    setStatus('submitting');
    setError(null);
    try {
      const response = await fetch(`/api/v1/groups/${group.id}/ballots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(submission),
      });

      if (!response.ok) {
        const failure = (await response.json()) as { code?: keyof typeof t.errors };
        setError((failure.code && t.errors[failure.code]) || t.common.error);
        setStatus('idle');
        return;
      }

      setStatus('done');
      // Re-render the page from the server so the group's own results and `hasVoted` come from the
      // same reveal gate that governs every other reader (FR-020) — never from this response alone.
      router.refresh();
    } catch {
      setError(t.errors.NETWORK_ERROR);
      setStatus('idle');
    }
  }

  return (
    <section aria-label={t.ballot.heading} className="mt-3">
      <h4 className="text-sm font-semibold">{t.ballot.heading}</h4>
      <p className="text-ink-muted mt-1 text-xs">{t.ballot.instructions}</p>

      <ul className="mt-3 space-y-2">
        {group.pairs.map((pair) => {
          const assigned = positionOf(draft, pair.id);
          const pairName = formatPairName(pair.players);
          return (
            <li key={pair.id} className="bg-surface border-border rounded-lg border p-3">
              <p className="text-sm font-medium">{pairName}</p>
              <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={pairName}>
                {positions.map((position) => {
                  const selected = assigned === position;
                  const heldBy = pairAt(draft, position);
                  return (
                    <button
                      key={position}
                      type="button"
                      // `aria-pressed` rather than a radio group: the same control both assigns and,
                      // when already chosen, reads as the current state to a screen reader.
                      aria-pressed={selected}
                      aria-label={`${pairName}: ${t.ballot.positionLabel(position)}`}
                      disabled={status !== 'idle'}
                      onClick={() =>
                        dispatch(
                          selected
                            ? { type: 'clear', pairId: pair.id }
                            : { type: 'assign', pairId: pair.id, position },
                        )
                      }
                      className={[
                        'min-h-11 min-w-11 rounded-md border px-3 text-sm tabular-nums',
                        selected
                          ? 'bg-accent text-accent-ink border-accent font-semibold'
                          : heldBy
                            ? 'border-border text-ink-muted'
                            : 'border-border text-ink',
                      ].join(' ')}
                    >
                      {position}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p role="alert" className="text-danger mt-3 text-sm">
          {error}
        </p>
      ) : null}

      {/* Announced without stealing focus: the voter learns the vote landed and the results opened. */}
      <p role="status" aria-live="polite" className="sr-only">
        {status === 'done' ? t.ballot.recordedAnnouncement : ''}
      </p>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!complete || status !== 'idle'}
          className="bg-accent text-accent-ink min-h-11 flex-1 rounded-md px-4 text-sm font-semibold disabled:opacity-50"
        >
          {status === 'submitting' ? t.ballot.submitting : t.ballot.submit}
        </button>
        {!complete ? <p className="text-ink-muted text-xs">{t.ballot.incomplete}</p> : null}
      </div>

      {!complete && remainingCount(draft) < group.pairs.length ? (
        <button
          type="button"
          onClick={() => dispatch({ type: 'fill-remaining' })}
          className="text-ink-muted mt-2 text-xs underline underline-offset-4"
        >
          {t.ballot.choosePosition}
        </button>
      ) : null}
    </section>
  );
}
