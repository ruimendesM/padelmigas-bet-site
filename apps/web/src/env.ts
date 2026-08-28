import { z } from 'zod';

/**
 * Fail-fast server environment.
 *
 * Every value here is server-only. None is prefixed `NEXT_PUBLIC_`, so none can reach a client
 * bundle (constitution: Server-Authoritative Trust Boundary). A missing or empty variable throws at
 * first access rather than letting the app run degraded — the quickstart states this explicitly:
 * "A missing or empty variable must fail startup loudly rather than degrade — no silent fallbacks."
 */
const serverEnvSchema = z.object({
  // Supabase Postgres via the pooler (ADR-003, as amended). Holds the database password, so it is
  // the single highest-value secret in the app and never leaves the server.
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL must be a Postgres connection string (postgresql://...)')
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: 'DATABASE_URL must use the postgres:// or postgresql:// scheme',
    }),
  VOTER_COOKIE_SECRET: z
    .string()
    .min(
      32,
      'VOTER_COOKIE_SECRET must be at least 32 characters; generate with `openssl rand -base64 48`',
    ),
  ADMIN_PASSWORD_HASH: z
    .string()
    .startsWith(
      '$argon2id$',
      'ADMIN_PASSWORD_HASH must be an argon2id PHC string ($argon2id$v=19$...)',
    ),
  RANKINGS_CSV_URL: z.string().url('RANKINGS_CSV_URL must be the public CSV export URL'),
  CRON_SECRET: z
    .string()
    .min(32, 'CRON_SECRET must be at least 32 characters; generate with `openssl rand -hex 32`'),
  RATE_LIMIT_SALT: z
    .string()
    .min(16, 'RATE_LIMIT_SALT must be at least 16 characters; it salts the in-memory IP hash'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

function describeFailure(error: z.ZodError): string {
  const lines = error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
  return [
    'Invalid server environment. The app refuses to start with an incomplete configuration.',
    ...lines,
    '',
    'See .env.example for the full list and copy it to apps/web/.env.local.',
  ].join('\n');
}

/**
 * Reads and validates the server environment exactly once.
 *
 * Call this from server code only. Importing this module from a client component is a build error
 * in Next.js because `process.env` access of non-public variables is stripped there; the boundary
 * test in `tests/architecture` also asserts no client module reaches it.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    VOTER_COOKIE_SECRET: process.env.VOTER_COOKIE_SECRET,
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    RANKINGS_CSV_URL: process.env.RANKINGS_CSV_URL,
    CRON_SECRET: process.env.CRON_SECRET,
    RATE_LIMIT_SALT: process.env.RATE_LIMIT_SALT,
  });

  if (!parsed.success) {
    throw new Error(describeFailure(parsed.error));
  }

  cached = parsed.data;
  return cached;
}
