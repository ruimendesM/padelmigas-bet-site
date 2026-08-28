import { getTournamentDetail } from '@padelmigas/api';
import { respond, toErrorResponse } from '../../../../../src/server/adapter.js';
import { getDeps } from '../../../../../src/server/deps.js';
import { recogniseVoter } from '../../../../../src/server/voter-cookie.js';

/**
 * `GET /api/v1/tournaments/{slug}` (FR-014, FR-015, FR-020, FR-021).
 *
 * Voter-dependent: the same URL answers differently for someone who has voted, so the adapter sends
 * `no-store` on every response. A cached reveal is Risk R1 exactly.
 *
 * A read never mints a voter identity — see `recogniseVoter`.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const { slug } = await context.params;
    const voterId = await recogniseVoter(request, getDeps());
    return await respond({
      parse: () => ({ slug, caller: { voterId } }),
      run: getTournamentDetail,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
