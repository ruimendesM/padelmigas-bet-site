import { lineupPayload } from '@padelmigas/contracts';
import { previewLineup } from '@padelmigas/api';
import { jsonBody, respond } from '../../../../../../src/server/adapter.js';
import { requireOrganiser } from '../../../../../../src/server/admin-auth.js';

/**
 * `POST /api/v1/admin/tournaments/preview` (FR-001, FR-002, FR-005, FR-006).
 *
 * Parse, guard, call one handler, serialise. No business branching lives here (Principle II).
 */
export async function POST(request: Request): Promise<Response> {
  return respond({
    parse: async () => {
      // Before the body is even read: an unauthenticated caller learns nothing about the schema.
      await requireOrganiser(request);
      return jsonBody(request, lineupPayload);
    },
    run: previewLineup,
  });
}
