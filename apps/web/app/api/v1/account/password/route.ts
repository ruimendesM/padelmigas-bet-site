import { changePasswordRequest } from '@padelmigas/contracts';
import { changePassword } from '@padelmigas/api';
import { jsonBody, respond } from '../../../../../src/server/adapter.js';
import {
  currentCaller,
  presentSession,
  requireSameSiteJson,
} from '../../../../../src/server/account-routes.js';

/**
 * `PUT /api/v1/account/password` — change password (FR-318).
 *
 * The handler bumps the session version, which signs out every other device; this device gets a fresh
 * session carrying the new version.
 */
export async function PUT(request: Request): Promise<Response> {
  return respond({
    parse: async () => {
      requireSameSiteJson(request);
      return {
        accountId: (await currentCaller(request)).accountId,
        request: await jsonBody(request, changePasswordRequest),
      };
    },
    run: changePassword,
    present: presentSession,
  });
}
