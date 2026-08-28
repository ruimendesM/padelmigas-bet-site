import { playerId as playerIdSchema } from '@padelmigas/contracts';
import { getPlayer } from '@padelmigas/api';
import { respond, toErrorResponse } from '../../../../../src/server/adapter.js';

/** `GET /api/v1/players/{playerId}` — a player and every appearance (FR-025, SC-008). */
export async function GET(
  _request: Request,
  context: { params: Promise<{ playerId: string }> },
): Promise<Response> {
  try {
    const { playerId: rawPlayerId } = await context.params;
    return await respond({
      parse: () => ({ playerId: playerIdSchema.parse(rawPlayerId) }),
      run: getPlayer,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
