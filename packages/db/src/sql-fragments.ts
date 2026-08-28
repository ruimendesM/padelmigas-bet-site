/**
 * SQL fragments shared by more than one repository.
 *
 * Kept as plain strings interpolated with `sql.unsafe`-free template composition (postgres.js allows
 * a fragment produced by the tag itself). Every fragment here is a fixed literal with no caller
 * input, so there is no injection surface: values always arrive as parameters.
 */

/**
 * Pair columns joined to both players' display names.
 *
 * `player_1_points` / `player_2_points` come from `pairs`, not from the players' current ratings:
 * points are captured at publish time and must not be rewritten by a later ranking sync (FR-007).
 */
export const PAIR_COLUMNS = `
  p.id,
  p.group_id,
  p.club,
  p.player_1_id,
  p.player_2_id,
  p.player_1_points,
  p.player_2_points,
  p.total_points,
  p.seed,
  pl1.display_name as player_1_name,
  pl2.display_name as player_2_name
`;

/** The joins `PAIR_COLUMNS` needs. */
export const PAIR_JOINS = `
  from pairs p
  join players pl1 on pl1.id = p.player_1_id
  join players pl2 on pl2.id = p.player_2_id
`;
