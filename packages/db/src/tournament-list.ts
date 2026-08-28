import type { TournamentListPage, TournamentListQuery } from '@padelmigas/core';
import type { Sql } from './client.js';
import { num, toTournament, type Row } from './mappers.js';

/**
 * The published-tournament listing (FR-023).
 *
 * Two properties this query must hold:
 *  - **Newest first, deterministically.** `published_at desc, id desc` — the id breaks the tie so
 *    two tournaments published in the same millisecond never swap places between page loads.
 *  - **No per-group figures.** `ballot_count` is the tournament total. A per-group count in a list
 *    payload would reveal aggregate information for a group the caller has not earned (SC-006), so
 *    the shape itself keeps that impossible rather than relying on the caller to omit it.
 */

/** Opaque cursor: `published_at` and `id` of the last item on the previous page. */
interface Cursor {
  readonly publishedAt: string;
  readonly id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.publishedAt}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const separator = decoded.lastIndexOf('|');
    if (separator <= 0) return null;
    const publishedAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (!publishedAt || !id) return null;
    // A malformed instant would silently return the whole table; reject instead.
    if (Number.isNaN(new Date(publishedAt).getTime())) return null;
    return { publishedAt, id };
  } catch {
    return null;
  }
}

export async function listPublished(
  sql: Sql,
  query: TournamentListQuery,
): Promise<TournamentListPage> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  // `now` is passed in from the Clock port; the store never decides open vs closed itself (SC-007).
  const rows = await sql<Row[]>`
    select t.id,
           t.name,
           t.slug,
           t.starts_at,
           t.published_at,
           coalesce(g.group_count, 0)  as group_count,
           coalesce(b.ballot_count, 0) as ballot_count
    from tournaments t
    left join (
      select tournament_id, count(*)::int as group_count
      from groups
      group by tournament_id
    ) g on g.tournament_id = t.id
    left join (
      select gr.tournament_id, count(ba.id)::int as ballot_count
      from groups gr
      join ballots ba on ba.group_id = gr.id
      group by gr.tournament_id
    ) b on b.tournament_id = t.id
    where t.published_at is not null
      and case ${query.status}
            when 'open'   then t.starts_at >  ${query.now}
            when 'closed' then t.starts_at <= ${query.now}
            else true
          end
      and (
        ${cursor === null}
        or (t.published_at, t.id) < (${cursor?.publishedAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)
      )
    order by t.published_at desc, t.id desc
    limit ${query.limit + 1}
  `;

  // One row over the limit tells us whether another page exists without a second COUNT query.
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;

  const items = page.map((row) => ({
    tournament: toTournament(row),
    groupCount: num(row, 'group_count'),
    ballotCount: num(row, 'ballot_count'),
  }));

  const last = page.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          publishedAt: (last['published_at'] instanceof Date
            ? last['published_at']
            : new Date(String(last['published_at']))
          ).toISOString(),
          id: String(last['id']),
        })
      : null;

  return { items, nextCursor };
}
