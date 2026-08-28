import { publishRequest } from '@padelmigas/contracts';
import { publishTournament } from '@padelmigas/api';
import { jsonBody, respond } from '../../../../../src/server/adapter.js';
import { requireOrganiser } from '../../../../../src/server/admin-auth.js';

/** `POST /api/v1/admin/tournaments` — publish a previewed lineup (FR-002, FR-006, FR-007). */
export async function POST(request: Request): Promise<Response> {
  return respond({
    parse: async () => {
      await requireOrganiser(request);
      return jsonBody(request, publishRequest);
    },
    run: publishTournament,
    status: 201,
  });
}
