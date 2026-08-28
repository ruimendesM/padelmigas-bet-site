import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  adminSessionCookie,
  clearAdminSessionCookie,
  createAdminSessionToken,
  verifyAdminPassword,
} from '../../../../src/server/admin-auth.js';
import { errorResponse } from '../../../../src/server/adapter.js';

/**
 * Organiser sign-in (FR-006).
 *
 * Deliberately **outside `/api/v1`**: the versioned surface is the product contract consumed by the
 * generated client and the OpenAPI document, and a login form is host plumbing, not product API. A
 * future mobile client has no organiser screen to build.
 */

const credentials = z.object({ password: z.string().min(1) });

export async function POST(request: Request): Promise<Response> {
  let parsed: z.infer<typeof credentials>;
  try {
    parsed = credentials.parse(await request.json());
  } catch {
    return errorResponse('MALFORMED_PAYLOAD', 'Indica a palavra-passe.');
  }

  // One generic failure for a wrong password and for a misconfigured hash: distinguishing them tells
  // an attacker whether the deployment is configured.
  if (!(await verifyAdminPassword(parsed.password))) {
    return errorResponse('UNAUTHORISED', 'Palavra-passe incorreta.');
  }

  return NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: {
        'Set-Cookie': adminSessionCookie(await createAdminSessionToken()),
        'Cache-Control': 'no-store',
      },
    },
  );
}

/** Sign out. Clearing the cookie is the whole of it — sessions are stateless (FR-006). */
export async function DELETE(): Promise<Response> {
  return NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: { 'Set-Cookie': clearAdminSessionCookie(), 'Cache-Control': 'no-store' },
    },
  );
}
