import { ballotSubmission, groupId as groupIdSchema } from '@padelmigas/contracts';
import { castBallot } from '@padelmigas/api';
import { jsonBody, respond, toErrorResponse } from '../../../../../../src/server/adapter.js';
import { getDeps } from '../../../../../../src/server/deps.js';
import { enforce } from '../../../../../../src/server/rate-limit.js';
import { requireVoter } from '../../../../../../src/server/voter-cookie.js';

/**
 * `POST /api/v1/groups/{groupId}/ballots` (FR-009 – FR-013, SC-005, SC-009).
 *
 * The identity is minted here if the caller has none, so the `voters` row and the cookie are created
 * together and the ballot can reference one that exists (FR-012). This is the only route that mints.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response> {
  try {
    const { groupId: rawGroupId } = await context.params;
    const deps = getDeps();
    // Before any write and before the body is read: a flood costs one hash, not one transaction.
    enforce(request, deps.clock.now());
    const voter = await requireVoter(request, deps);

    return await respond({
      parse: async () => ({
        groupId: groupIdSchema.parse(rawGroupId),
        submission: await jsonBody(request, ballotSubmission),
        caller: { voterId: voter.voterId },
      }),
      run: castBallot,
      status: 201,
      ...(voter.setCookie === null ? {} : { headers: { 'Set-Cookie': voter.setCookie } }),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
