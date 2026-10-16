import { accountSearchQuery } from '@padelmigas/contracts';
import { searchAccounts } from '@padelmigas/api';
import { respond, searchParams } from '../../../../../src/server/adapter.js';
import { requireOrganiser } from '../../../../../src/server/admin-auth.js';

/** `GET /api/v1/admin/accounts?q=` — find voter accounts by part of a username (FR-319). */
export async function GET(request: Request): Promise<Response> {
  return respond({
    parse: async () => {
      await requireOrganiser(request);
      return searchParams(request, accountSearchQuery);
    },
    run: searchAccounts,
  });
}
