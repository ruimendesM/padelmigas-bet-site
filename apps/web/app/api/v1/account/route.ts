import { registerRequest } from '@padelmigas/contracts';
import { getAccount, register } from '@padelmigas/api';
import { jsonBody, respond } from '../../../../src/server/adapter.js';
import {
  currentCaller,
  enforceAuthRateLimit,
  requireSameSiteJson,
  presentSession,
} from '../../../../src/server/account-routes.js';
import { getDeps } from '../../../../src/server/deps.js';
import { deviceVoterId } from '../../../../src/server/voter-cookie.js';

/**
 * `POST /api/v1/account` — register and sign in on this device (FR-303 – FR-309, FR-317).
 *
 * The device's anonymous voter is offered for adoption, so ballots already cast here become the new
 * account's (FR-309). The repository adopts it only if no account owns it (FR-313).
 */
export async function POST(request: Request): Promise<Response> {
  return respond({
    parse: async () => {
      // Before the body is read: a flood costs one hash, not one argon2 run.
      requireSameSiteJson(request);
      enforceAuthRateLimit(request);
      return {
        request: await jsonBody(request, registerRequest),
        deviceVoterId: await deviceVoterId(request, getDeps()),
      };
    },
    run: register,
    status: 201,
    present: presentSession,
  });
}

/** `GET /api/v1/account` — the signed-in account on this device (FR-322). */
export async function GET(request: Request): Promise<Response> {
  return respond({
    parse: async () => ({ accountId: (await currentCaller(request)).accountId }),
    run: getAccount,
  });
}
