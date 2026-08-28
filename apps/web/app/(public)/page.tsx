import Link from 'next/link';
import { formatStartsAt } from '@padelmigas/ui-logic';
import { t } from '../../src/i18n/index.js';
import { fetchTournaments } from '../../src/server/page-data.js';
import { EmptyState } from '../../components/states/index.js';

/**
 * The landing page (FR-023).
 *
 * Published tournaments, newest first, with their start time and group count. It carries no
 * per-group figure at all — the list response has nowhere to put one, which is what keeps SC-006
 * structural rather than a thing to remember.
 */

// The list depends on the server clock for open-vs-closed, so it is never statically rendered.
export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const { tournaments } = await fetchTournaments({ status: 'all' });

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{t.tournamentList.title}</h1>
      <p className="text-ink-muted mt-1 text-sm">{t.app.tagline}</p>

      {tournaments.length === 0 ? (
        <div className="mt-6">
          <EmptyState message={t.tournamentList.empty} />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {tournaments.map((tournament) => (
            <li key={tournament.id}>
              <Link
                href={`/torneios/${tournament.slug}`}
                className="bg-surface border-border hover:border-accent block rounded-lg border p-4"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-base font-medium">{tournament.name}</h2>
                  <span
                    className={
                      tournament.status === 'open'
                        ? 'text-accent whitespace-nowrap text-xs'
                        : 'text-ink-muted whitespace-nowrap text-xs'
                    }
                  >
                    {tournament.status === 'open'
                      ? t.tournamentList.openBadge
                      : t.tournamentList.closedBadge}
                  </span>
                </div>
                <p className="text-ink-muted mt-1 text-sm">
                  {t.tournamentList.startsAt}: {formatStartsAt(tournament.startsAt)}
                </p>
                <p className="text-ink-muted mt-1 text-xs">
                  {t.tournamentList.groupCount(tournament.groupCount)} ·{' '}
                  {t.tournamentList.ballotCount(tournament.ballotCount)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
