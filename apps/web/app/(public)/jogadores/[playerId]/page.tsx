import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDate, formatPoints } from '@padelmigas/ui-logic';
import { isDomainError } from '@padelmigas/core';
import { t } from '../../../../src/i18n/index.js';
import { fetchPlayer } from '../../../../src/server/page-data.js';
import { EmptyState } from '../../../../components/states/index.js';

/**
 * One player and every tournament they have played (FR-025, SC-008).
 *
 * The page makes the identity property visible: one person is one page with a continuous history. A
 * duplicate identity in the ranking sheet would show up here as two half-empty pages, which is the
 * failure ADR-007 is designed to make loud rather than silent.
 */

export const dynamic = 'force-dynamic';

export default async function PlayerPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;

  let player;
  try {
    player = await fetchPlayer(playerId);
  } catch (error) {
    if (
      isDomainError(error) &&
      (error.code === 'NOT_FOUND' || error.code === 'MALFORMED_PAYLOAD')
    ) {
      notFound();
    }
    throw error;
  }

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{player.name}</h1>
      <dl className="text-ink-muted mt-2 space-y-1 text-sm">
        {player.club ? (
          <div className="flex gap-2">
            <dt>{t.player.club}:</dt>
            <dd className="text-ink">{player.club}</dd>
          </div>
        ) : null}
        {player.currentPoints === null ? null : (
          <div className="flex gap-2">
            <dt>{t.player.currentPoints}:</dt>
            <dd className="text-ink tabular-nums">
              {formatPoints(player.currentPoints)} {t.common.points}
            </dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt>{t.player.rankingId}:</dt>
          <dd className="text-ink tabular-nums">{player.externalId}</dd>
        </div>
      </dl>

      <h2 className="mt-6 text-base font-semibold">{t.player.appearances}</h2>

      {player.appearances.length === 0 ? (
        <div className="mt-3">
          <EmptyState message={t.player.noAppearances} />
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {player.appearances.map((appearance) => (
            <li
              key={`${appearance.tournament.id}-${appearance.groupLabel}`}
              className="bg-surface border-border rounded-lg border p-4"
            >
              <Link
                href={`/torneios/${appearance.tournament.slug}`}
                className="hover:text-accent text-sm font-medium"
              >
                {appearance.tournament.name}
              </Link>
              <p className="text-ink-muted mt-1 text-xs">
                {formatDate(appearance.tournament.startsAt)} · {t.common.group}{' '}
                {appearance.groupLabel}
              </p>
              <p className="text-ink-muted mt-1 text-xs">
                {t.player.partner}:{' '}
                <Link
                  href={`/jogadores/${appearance.partner.id}`}
                  className="text-ink hover:text-accent"
                >
                  {appearance.partner.name}
                </Link>
              </p>
              <p className="text-ink-muted mt-1 text-xs tabular-nums">
                {/* What was true on the day, not what is true today (FR-007). */}
                {t.player.pointsAtTournament}: {formatPoints(appearance.pointsAtTournament)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
