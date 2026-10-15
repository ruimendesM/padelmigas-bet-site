'use client';

import { useState } from 'react';
import type { AccountSummaryDto, PasswordResetResponse } from '@padelmigas/contracts';
import { ApiRequestError } from '@padelmigas/client';
import { formatStartsAt } from '@padelmigas/ui-logic';
import { api } from '../../src/api.js';
import { t } from '../../src/i18n/index.js';

/**
 * Voter accounts, organiser side (feature 004, FR-319, FR-320).
 *
 * Search by username, then reset. The temporary password is held in component state only for as
 * long as it is on screen: it came from the one response that will ever contain it, and the organiser
 * has to pass it on by hand. Dismissing it clears it.
 */
export function AccountsPanel() {
  const [query, setQuery] = useState('');
  const [accounts, setAccounts] = useState<readonly AccountSummaryDto[] | null>(null);
  const [busy, setBusy] = useState<'none' | 'search' | string>('none');
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<
    (PasswordResetResponse & { readonly username: string }) | null
  >(null);
  const [copied, setCopied] = useState(false);

  function fail(failure: unknown): void {
    const code = failure instanceof ApiRequestError ? failure.code : 'NETWORK_ERROR';
    setError(t.errors[code as keyof typeof t.errors] ?? t.common.error);
  }

  async function search(): Promise<void> {
    setBusy('search');
    setError(null);
    try {
      setAccounts((await api.searchAccounts({ query: { q: query } })).accounts);
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy('none');
    }
  }

  async function reset(account: AccountSummaryDto): Promise<void> {
    if (!window.confirm(t.admin.accountsResetConfirm(account.username))) return;
    setBusy(account.id);
    setError(null);
    setCopied(false);
    try {
      const response = await api.resetAccountPassword({ accountId: account.id });
      setIssued({ ...response, username: account.username });
      setAccounts(
        (current) =>
          current?.map((row) =>
            row.id === account.id ? { ...row, temporaryPasswordPending: true } : row,
          ) ?? null,
      );
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy('none');
    }
  }

  async function copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard can be refused (permissions, insecure context); the value is on screen to copy by hand.
    }
  }

  return (
    <section aria-labelledby="accounts-heading" className="border-border mt-12 border-t pt-6">
      <h2 id="accounts-heading" className="text-base font-semibold">
        {t.admin.accountsHeading}
      </h2>
      <p className="text-ink-muted mt-1 text-xs">{t.admin.accountsHint}</p>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label className="sr-only" htmlFor="accounts-query">
          {t.admin.accountsQuery}
        </label>
        <input
          id="accounts-query"
          type="search"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t.admin.accountsQuery}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="bg-surface border-border min-h-11 w-full rounded-md border px-3 text-sm"
        />
        <button
          type="submit"
          disabled={busy !== 'none' || query.trim().length === 0}
          className="border-border min-h-11 whitespace-nowrap rounded-md border px-4 text-sm disabled:opacity-50"
        >
          {busy === 'search' ? t.admin.accountsSearching : t.admin.accountsSearch}
        </button>
      </form>

      {error ? (
        <p role="alert" className="text-danger mt-3 text-sm">
          {error}
        </p>
      ) : null}

      {issued ? (
        <div role="status" className="border-accent mt-4 rounded-md border p-3">
          <p className="text-sm font-semibold">
            {t.admin.accountsTemporaryHeading(issued.username)}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="bg-surface rounded px-2 py-1 font-mono text-base tracking-wider">
              {issued.temporaryPassword}
            </code>
            <button
              type="button"
              onClick={() => void copy(issued.temporaryPassword)}
              className="border-border min-h-11 rounded-md border px-3 text-xs"
            >
              {copied ? t.admin.accountsCopied : t.admin.accountsCopy}
            </button>
            <button
              type="button"
              onClick={() => setIssued(null)}
              className="text-ink-muted min-h-11 px-2 text-xs"
            >
              {t.common.close}
            </button>
          </div>
          <p className="text-ink-muted mt-2 text-xs">
            {t.admin.accountsTemporaryHint(formatStartsAt(issued.expiresAt))}
          </p>
        </div>
      ) : null}

      {accounts !== null ? (
        accounts.length === 0 ? (
          <p className="text-ink-muted mt-4 text-sm">{t.admin.accountsNone}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {accounts.map((account) => (
              <li
                key={account.id}
                className="border-border flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{account.username}</p>
                  <p className="text-ink-muted text-xs">
                    {t.admin.accountsCreated} {formatStartsAt(account.createdAt)}
                    {account.temporaryPasswordPending ? ` · ${t.admin.accountsPending}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void reset(account)}
                  disabled={busy !== 'none'}
                  className="border-border min-h-11 whitespace-nowrap rounded-md border px-3 text-xs disabled:opacity-50"
                >
                  {busy === account.id ? t.admin.accountsResetting : t.admin.accountsReset}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
