import { groupId as groupIdSchema } from '@padelmigas/contracts';
import { getGroupResults } from '@padelmigas/api';
import { respond, toErrorResponse } from '../../../../../../src/server/adapter.js';
import { getDeps } from '../../../../../../src/server/deps.js';
import { recogniseVoter } from '../../../../../../src/server/voter-cookie.js';

/** `GET /api/v1/groups/{groupId}/results` — behind the reveal gate (FR-020, FR-021). */
export async function GET(
  request: Request,
  context: { params: Promise<{ groupId: string }> },
): Promise<Response> {
  try {
    const { groupId: rawGroupId } = await context.params;
    const voterId = await recogniseVoter(request, getDeps());
    return await respond({
      parse: () => ({ groupId: groupIdSchema.parse(rawGroupId), caller: { voterId } }),
      run: getGroupResults,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
