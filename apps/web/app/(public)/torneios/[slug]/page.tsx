import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  formatPairName,
  formatPoints,
  formatStartsAt,
  resultsStateFor,
} from '@padelmigas/ui-logic';
import { isDomainError } from '@padelmigas/core';
import type { TournamentDetailDto } from '@padelmigas/contracts';
import { t } from '../../../../src/i18n/index.js';
import { fetchTournament } from '../../../../src/server/page-data.js';
import { BallotForm } from '../../../../components/BallotForm.js';
import { GroupResults } from '../../../../components/GroupResults.js';

/**
 * One tournament: its groups, the voting form, and results where the caller has earned them
 * (FR-009, FR-014, FR-015, FR-020).
 *
 * Per-group independence is visible in the markup: each group decides its own form-or-results from
 * its own `hasVoted`, so voting in group A leaves group B untouched and still blank (FR-015).
 */

export const dynamic = 'force-dynamic';

async function load(slug: string): Promise<TournamentDetailDto> {
  try {
    return await fetchTournament(slug);
  } catch (error) {
    if (isDomainError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
}

/**
 * Page metadata (SC-006).
 *
 * The name and the start time only. A share card must never carry a group's standings: a link
 * preview is cached by every chat app that renders it, which would leak an unrevealed aggregate to
 * everyone who saw the link — Risk R1 with extra reach.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const tournament = await fetchTournament(slug);
    const description = `${t.tournament.startsAt}: ${formatStartsAt(tournament.startsAt)}`;
    return {
      title: tournament.name,
      description,
      openGraph: { title: tournament.name, description, type: 'website' },
    };
  } catch {
    return { title: t.app.name };
  }
}

export default async function TournamentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tournament = await load(slug);

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{tournament.name}</h1>
      <p className="text-ink-muted mt-1 text-sm">
        {t.tournament.startsAt}: {formatStartsAt(tournament.startsAt)}
      </p>
      <p
        className={
          tournament.status === 'open' ? 'text-accent mt-1 text-xs' : 'text-ink-muted mt-1 text-xs'
        }
      >
        {tournament.status === 'open' ? t.tournament.votingOpenUntil : t.tournament.votingClosed}
      </p>

      <h2 className="mt-6 text-base font-semibold">{t.tournament.groupsHeading}</h2>

      <div className="mt-3 space-y-8">
        {tournament.groups.map((group) => (
          <section key={group.id} aria-label={`${t.common.group} ${group.label}`}>
            <h3 className="text-sm font-semibold">
              {t.common.group} {group.label}
            </h3>

            <ul className="mt-2 space-y-1">
              {group.pairs.map((pair) => (
                <li
                  key={pair.id}
                  className="text-ink-muted flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="text-ink">{formatPairName(pair.players)}</span>
                  <span className="whitespace-nowrap text-xs tabular-nums">
                    {formatPoints(pair.totalPoints)} {t.common.points}
                  </span>
                </li>
              ))}
            </ul>

            {group.hasVoted ? (
              <p className="text-accent mt-3 text-xs">{t.ballot.recorded}</p>
            ) : group.votingOpen ? (
              <BallotForm group={group} />
            ) : (
              <p className="text-ink-muted mt-3 text-xs">{t.ballot.closed}</p>
            )}

            <GroupResults
              // The gate already ran on the server: `results` is present exactly when it opened, so
              // the component is told what to render rather than deciding it again (FR-020).
              state={resultsStateFor({
                revealed: group.hasVoted || !group.votingOpen,
                results: group.results ?? null,
              })}
              pairs={group.pairs}
            />
          </section>
        ))}
      </div>
    </>
  );
}
