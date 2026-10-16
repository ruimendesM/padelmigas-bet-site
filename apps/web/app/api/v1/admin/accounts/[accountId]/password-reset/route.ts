import { accountId as accountIdSchema } from '@padelmigas/contracts';
import { resetAccountPassword } from '@padelmigas/api';
import { respond } from '../../../../../../../src/server/adapter.js';
import { requireOrganiser } from '../../../../../../../src/server/admin-auth.js';

/**
 * `POST /api/v1/admin/accounts/{accountId}/password-reset` — issue a temporary password (FR-320).
 *
 * The response is the only place the temporary password ever appears, and like every response from
 * the adapter it is sent `no-store`.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
): Promise<Response> {
  return respond({
    parse: async () => {
      await requireOrganiser(request);
      const { accountId } = await context.params;
      return { accountId: accountIdSchema.parse(accountId) };
    },
    run: resetAccountPassword,
    status: 201,
  });
}
