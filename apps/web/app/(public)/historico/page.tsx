import Link from 'next/link';
import { formatDate, resultsStateFor } from '@padelmigas/ui-logic';
import { t } from '../../../src/i18n/index.js';
import { fetchTournament, fetchTournaments } from '../../../src/server/page-data.js';
import { GroupResults } from '../../../components/GroupResults.js';
import { EmptyState } from '../../../components/states/index.js';

/**
 * History (FR-023, FR-024).
 *
 * Closed tournaments, newest first, each with the crowd's final predicted standings. Voting has
 * closed for everything listed here, so the reveal gate is open to everyone by definition (FR-021) —
 * the page still asks `resultsStateFor` rather than assuming it, because "closed" is a server
 * decision and this page must not hold a second opinion about it.
 */

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const { tournaments } = await fetchTournaments({ status: 'closed' });

  if (tournaments.length === 0) {
    return (
      <>
        <h1 className="text-xl font-semibold tracking-tight">{t.history.title}</h1>
        <div className="mt-6">
          <EmptyState message={t.history.empty} />
        </div>
      </>
    );
  }

  // One detail read per closed tournament. The list is small by nature — a club plays a handful of
  // tournaments a year — so this stays a bounded number of queries rather than a paginated fan-out.
  const details = await Promise.all(
    tournaments.map(async (summary) => fetchTournament(summary.slug)),
  );

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{t.history.title}</h1>

      <div className="mt-6 space-y-10">
        {details.map((tournament) => (
          <article key={tournament.id}>
            <h2 className="text-base font-medium">
              <Link href={`/torneios/${tournament.slug}`} className="hover:text-accent">
                {tournament.name}
              </Link>
            </h2>
            <p className="text-ink-muted mt-1 text-xs">
              {formatDate(tournament.startsAt)} ·{' '}
              {t.tournamentList.ballotCount(tournament.ballotCount)}
            </p>

            <div className="mt-3 space-y-6">
              {tournament.groups.map((group) => (
                <section key={group.id} aria-label={`${t.common.group} ${group.label}`}>
                  <h3 className="text-sm font-semibold">
                    {t.common.group} {group.label} · {t.history.finalPrediction}
                  </h3>
                  <GroupResults
                    state={resultsStateFor({
                      revealed: !group.votingOpen,
                      results: group.results ?? null,
                    })}
                    pairs={group.pairs}
                  />
                </section>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
