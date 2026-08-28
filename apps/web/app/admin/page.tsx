'use client';

import { useState } from 'react';
import type { LineupPreviewDto } from '@padelmigas/contracts';
import { formatPairName, formatPoints, formatStartsAt } from '@padelmigas/ui-logic';
import { t } from '../../src/i18n/index.js';

/**
 * The organiser page (FR-002, FR-006).
 *
 * **Preview is mandatory before publish.** The publish button does not exist until a preview has
 * succeeded, and any edit to the payload retracts it. Publishing is the one irreversible public
 * action in the product and Risk R9 — a wrong start time or a mis-typed lineup on a public page —
 * has no cheap undo, so paste-and-publish is made structurally impossible rather than discouraged.
 *
 * A client component because it is a form with three states and no shareable URL; nothing on it is
 * public, and it reaches the API over HTTP through the same `/api/v1` surface everyone else uses.
 */

interface Issue {
  path: string;
  message: string;
}

type Failure = { code?: keyof typeof t.errors; message?: string; issues?: Issue[] };

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [payload, setPayload] = useState('');
  const [preview, setPreview] = useState<LineupPreviewDto | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'none' | 'preview' | 'publish' | 'sync' | 'signin'>('none');
  const [notice, setNotice] = useState<string | null>(null);

  function fail(failure: Failure): void {
    setError((failure.code && t.errors[failure.code]) || failure.message || t.common.error);
    setIssues(failure.issues ?? []);
  }

  /** Any edit retracts the preview: what was validated is no longer what would be published. */
  function editPayload(next: string): void {
    setPayload(next);
    setPreview(null);
    setIssues([]);
    setError(null);
  }

  function parsePayload(): unknown | null {
    try {
      return JSON.parse(payload);
    } catch {
      setError(t.errors.MALFORMED_PAYLOAD);
      setIssues([]);
      return null;
    }
  }

  async function signIn(): Promise<void> {
    setBusy('signin');
    setError(null);
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError(t.admin.signInFailed);
        return;
      }
      setSignedIn(true);
      // Not held in state a moment longer than the request needs it.
      setPassword('');
    } finally {
      setBusy('none');
    }
  }

  async function runPreview(): Promise<void> {
    const parsed = parsePayload();
    if (parsed === null) return;

    setBusy('preview');
    setError(null);
    setIssues([]);
    try {
      const response = await fetch('/api/v1/admin/tournaments/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const payloadBody = (await response.json()) as LineupPreviewDto | Failure;
      if (!response.ok) {
        setPreview(null);
        fail(payloadBody as Failure);
        return;
      }
      setPreview(payloadBody as LineupPreviewDto);
    } catch {
      setError(t.errors.NETWORK_ERROR);
    } finally {
      setBusy('none');
    }
  }

  async function publish(): Promise<void> {
    const parsed = parsePayload();
    if (parsed === null || preview === null) return;

    setBusy('publish');
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/tournaments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // `confirm` is added here, at the click, and is never part of the pasted payload: the
        // confirmation has to come from the organiser's action, not from what they pasted (FR-002).
        body: JSON.stringify({ ...(parsed as object), confirm: true }),
      });
      if (!response.ok) {
        fail((await response.json()) as Failure);
        return;
      }
      setNotice(t.admin.published);
      setPreview(null);
      setPayload('');
    } catch {
      setError(t.errors.NETWORK_ERROR);
    } finally {
      setBusy('none');
    }
  }

  async function syncRankings(): Promise<void> {
    setBusy('sync');
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/rankings/sync', { method: 'POST' });
      const report = (await response.json()) as {
        playersCreated?: number;
        playersUpdated?: number;
        stale?: boolean;
      } & Failure;
      if (!response.ok) {
        fail(report);
        return;
      }
      setNotice(
        [
          t.admin.syncReport(report.playersCreated ?? 0, report.playersUpdated ?? 0),
          report.stale ? t.admin.syncStale : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    } catch {
      setError(t.errors.NETWORK_ERROR);
    } finally {
      setBusy('none');
    }
  }

  if (!signedIn) {
    return (
      <>
        <h1 className="text-xl font-semibold tracking-tight">{t.admin.title}</h1>
        <form
          className="mt-6 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn();
          }}
        >
          <label className="block text-sm" htmlFor="admin-password">
            {t.admin.password}
          </label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="bg-surface border-border min-h-11 w-full rounded-md border px-3 text-sm"
          />
          {error ? (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy !== 'none' || password.length === 0}
            className="bg-accent text-accent-ink min-h-11 rounded-md px-4 text-sm font-semibold disabled:opacity-50"
          >
            {t.admin.signIn}
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t.admin.title}</h1>
        <button
          type="button"
          onClick={() => void syncRankings()}
          disabled={busy !== 'none'}
          className="border-border text-ink-muted min-h-11 rounded-md border px-3 text-xs"
        >
          {busy === 'sync' ? t.admin.syncing : t.admin.syncRankings}
        </button>
      </div>

      {notice ? (
        <p role="status" className="text-accent mt-3 text-sm">
          {notice}
        </p>
      ) : null}

      <label className="mt-6 block text-sm" htmlFor="lineup-payload">
        {t.admin.payloadLabel}
      </label>
      <p className="text-ink-muted mt-1 text-xs">{t.admin.payloadHint}</p>
      <textarea
        id="lineup-payload"
        value={payload}
        onChange={(event) => editPayload(event.target.value)}
        rows={12}
        spellCheck={false}
        className="bg-surface border-border mt-2 w-full rounded-md border p-3 font-mono text-xs"
      />

      {error ? (
        <p role="alert" className="text-danger mt-3 text-sm">
          {error}
        </p>
      ) : null}

      {issues.length > 0 ? (
        <section className="mt-3" aria-label={t.admin.issuesHeading}>
          <h2 className="text-sm font-semibold">{t.admin.issuesHeading}</h2>
          {/* Every offending entry at once: an organiser should not resubmit six times to find six
              typos (FR-005). */}
          <ul className="text-danger mt-1 space-y-1 text-xs">
            {issues.map((issue, index) => (
              <li key={`${issue.path}-${index}`}>
                <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void runPreview()}
          disabled={busy !== 'none' || payload.trim().length === 0}
          className="border-accent text-accent min-h-11 rounded-md border px-4 text-sm font-semibold disabled:opacity-50"
        >
          {busy === 'preview' ? t.admin.previewing : t.admin.preview}
        </button>

        {preview ? (
          <button
            type="button"
            onClick={() => void publish()}
            disabled={busy !== 'none'}
            className="bg-accent text-accent-ink min-h-11 rounded-md px-4 text-sm font-semibold disabled:opacity-50"
          >
            {busy === 'publish' ? t.admin.publishing : t.admin.publish}
          </button>
        ) : null}
      </div>

      {preview ? (
        <section className="mt-8" aria-label={t.admin.preview}>
          <h2 className="text-base font-semibold">{preview.name}</h2>
          <p className="text-ink-muted mt-1 text-sm">
            /torneios/{preview.slug} · {formatStartsAt(preview.startsAt)}
          </p>

          <div className="mt-4 space-y-5">
            {preview.groups.map((group) => (
              <section key={group.label} aria-label={`${t.common.group} ${group.label}`}>
                <h3 className="text-sm font-semibold">
                  {t.common.group} {group.label}
                </h3>
                <ol className="mt-1 space-y-1">
                  {group.pairs.map((pair) => (
                    <li
                      key={pair.id}
                      className="text-ink-muted flex items-baseline justify-between gap-3 text-sm"
                    >
                      <span className="text-ink">
                        {pair.seed}. {formatPairName(pair.players)}
                      </span>
                      <span className="whitespace-nowrap text-xs tabular-nums">
                        {formatPoints(pair.totalPoints)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>

          <h3 className="mt-6 text-sm font-semibold">{t.admin.resolvedPlayers}</h3>
          <ul className="text-ink-muted mt-1 space-y-0.5 text-xs">
            {preview.resolvedPlayers.map((resolved) => (
              <li key={resolved.externalId}>
                {resolved.inputName} → {resolved.displayName} (#{resolved.externalId})
                {resolved.isNew ? ` · ${t.admin.newPlayer}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
