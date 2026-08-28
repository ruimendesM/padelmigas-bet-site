import { tournamentListQuery } from '@padelmigas/contracts';
import { listTournaments } from '@padelmigas/api';
import { respond, searchParams } from '../../../../src/server/adapter.js';

/** `GET /api/v1/tournaments` — published tournaments, newest first (FR-023). */
export async function GET(request: Request): Promise<Response> {
  return respond({
    parse: () => searchParams(request, tournamentListQuery),
    run: listTournaments,
  });
}
