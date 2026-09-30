import { publishRequest } from '@padelmigas/contracts';
import { replaceTournament } from '@padelmigas/api';
import { jsonBody, respond } from '../../../../../../../src/server/adapter.js';
import { requireOrganiser } from '../../../../../../../src/server/admin-auth.js';

/**
 * `POST /api/v1/admin/tournaments/{slug}/replace` — invalidate an open tournament and publish its
 * corrected lineup at the same address (feature 003, FR-204 – FR-210).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  return respond({
    parse: async () => {
      await requireOrganiser(request);
      const { slug } = await context.params;
      return { slug, body: await jsonBody(request, publishRequest) };
    },
    run: replaceTournament,
    status: 201,
  });
}
