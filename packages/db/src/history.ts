import type { HistoryRepository } from '@padelmigas/core';
import type { Sql } from './client.js';
import { toAppearance, type Row } from './mappers.js';

/**
 * Player history (FR-025).
 *
 * Joined through `pairs`, both slots, so one player row serves every appearance — the property
 * SC-008 checks: "exactly one player record for that person" across tournaments.
 *
 * `points_at_tournament` reads from `pairs`, not from `player_ratings`: the answer is the points the
 * player had when that tournament was published, not their points today (FR-007).
 *
 * `ballot_count` here is a per-tournament total, never per group — a per-group figure in this payload
 * would reveal aggregate information for a group the caller has not earned (SC-006).
 */
export function createHistoryRepository(sql: Sql): HistoryRepository {
  return {
    async appearancesFor(playerId) {
      const rows = await sql<Row[]>`
        with appearance as (
          select p.id as pair_id,
                 p.group_id,
                 case when p.player_1_id = ${playerId} then p.player_2_id else p.player_1_id end
                   as partner_id,
                 case when p.player_1_id = ${playerId} then p.player_2_points else p.player_1_points end
                   as partner_points,
                 case when p.player_1_id = ${playerId} then p.player_1_points else p.player_2_points end
                   as points_at_tournament
          from pairs p
          where p.player_1_id = ${playerId} or p.player_2_id = ${playerId}
        )
        select t.id,
               t.name,
               t.slug,
               t.starts_at,
               t.published_at,
               g.label                      as group_label,
               a.partner_id,
               partner.display_name         as partner_name,
               a.points_at_tournament,
               coalesce(gc.group_count, 0)  as group_count,
               coalesce(bc.ballot_count, 0) as ballot_count
        from appearance a
        join groups g       on g.id = a.group_id
        join tournaments t  on t.id = g.tournament_id
        join players partner on partner.id = a.partner_id
        left join (
          select tournament_id, count(*)::int as group_count
          from groups
          group by tournament_id
        ) gc on gc.tournament_id = t.id
        left join (
          select gr.tournament_id, count(ba.id)::int as ballot_count
          from groups gr
          join ballots ba on ba.group_id = gr.id
          group by gr.tournament_id
        ) bc on bc.tournament_id = t.id
        -- Drafts are never public, so they never appear in a player's history either.
        where t.published_at is not null
        order by t.published_at desc, t.id desc
      `;
      return rows.map(toAppearance);
    },
  };
}
