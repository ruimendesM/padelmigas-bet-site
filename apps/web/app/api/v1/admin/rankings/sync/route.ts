import { syncRankings } from '@padelmigas/api';
import { respond } from '../../../../../../src/server/adapter.js';
import { requireOrganiserOrCron } from '../../../../../../src/server/admin-auth.js';

/**
 * `POST /api/v1/admin/rankings/sync` (FR-004).
 *
 * The only route that accepts a bearer `CRON_SECRET` as well as an organiser session: the scheduler
 * has no human session, and widening that credential to the publish route would put a public
 * tournament one leaked secret away (contracts/README rule 7).
 */
export async function POST(request: Request): Promise<Response> {
  return respond({
    parse: async () => {
      await requireOrganiserOrCron(request);
      return undefined;
    },
    run: (_input, deps) => syncRankings(deps),
  });
}
