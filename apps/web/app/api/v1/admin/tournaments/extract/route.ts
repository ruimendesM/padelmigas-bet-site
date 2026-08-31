import { extractLineupBody } from '@padelmigas/contracts';
import { extractLineup } from '@padelmigas/api';
import { jsonBody, respond } from '../../../../../../src/server/adapter.js';
import { requireOrganiser } from '../../../../../../src/server/admin-auth.js';

/**
 * `POST /api/v1/admin/tournaments/extract` (FR-101, FR-116 – FR-119).
 *
 * Parse, guard, call one handler, serialise. No business branching lives here (Principle II).
 *
 * The guard runs before the body is read, so an unauthenticated caller neither learns the schema nor
 * causes an upstream extraction call (FR-116).
 */
export async function POST(request: Request): Promise<Response> {
  return respond({
    parse: async () => {
      await requireOrganiser(request);
      return jsonBody(request, extractLineupBody);
    },
    run: extractLineup,
  });
}
