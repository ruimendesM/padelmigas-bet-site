import { lineupPayload } from '@padelmigas/contracts';
import { previewReplacement } from '@padelmigas/api';
import { jsonBody, respond } from '../../../../../../../../src/server/adapter.js';
import { requireOrganiser } from '../../../../../../../../src/server/admin-auth.js';

/**
 * `POST /api/v1/admin/tournaments/{slug}/replace/preview` — validate a corrected lineup and show
 * which groups keep their votes, persisting nothing (feature 003, FR-202, FR-203).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  return respond({
    parse: async () => {
      // Before the body is even read: an unauthenticated caller learns nothing about the schema.
      await requireOrganiser(request);
      const { slug } = await context.params;
      return { slug, body: await jsonBody(request, lineupPayload) };
    },
    run: previewReplacement,
  });
}
