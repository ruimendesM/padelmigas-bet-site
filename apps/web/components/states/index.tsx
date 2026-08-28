import { t } from '../../src/i18n/index.js';

/**
 * Loading, empty and error states (FR-019).
 *
 * One component per state, in one file, because the three are only meaningful next to each other:
 * "nothing to show" and "we could not tell you" look identical if you write them separately and
 * carelessly, and the difference is the whole of FR-019.
 *
 * Every string comes from `src/i18n` — no visible copy is written inline anywhere in the app
 * (constitution: Locale).
 */

export function LoadingState({ label = t.common.loading }: { label?: string }) {
  return (
    <p className="text-ink-muted py-8 text-center text-sm" role="status" aria-live="polite">
      {label}
    </p>
  );
}

/** Nothing exists to show. A statement of fact, not a failure. */
export function EmptyState({ message }: { message: string }) {
  return (
    <p className="border-border text-ink-muted rounded-lg border border-dashed px-4 py-8 text-center text-sm">
      {message}
    </p>
  );
}

/** Something went wrong. Distinct from empty, and offers the one action that can help. */
export function ErrorState({
  message = t.common.error,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="border-danger/40 bg-danger/10 rounded-lg border px-4 py-4 text-sm">
      <p className="text-ink">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="text-accent mt-2 underline underline-offset-4"
        >
          {t.common.retry}
        </button>
      ) : null}
    </div>
  );
}
