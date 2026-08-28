import postgres from 'postgres';

/**
 * The one and only place in this repository that constructs a database client (Principle II,
 * ADR-003 as amended). `.dependency-cruiser.cjs` rule `no-db-client-outside-db` fails CI if any
 * other module imports the driver.
 *
 * The connection string points at Supabase's **connection pooler**, not the direct 5432 endpoint:
 * serverless invocations open and abandon connections in bursts and would exhaust the direct limit
 * at exactly the moment a tournament starts (Risk R8).
 */

export type Sql = postgres.Sql<Record<string, never>>;

export interface DbConfig {
  /** Postgres connection string. Server-only: it carries the database password. */
  readonly connectionString: string;
  /**
   * Maximum connections held by this process. Small on purpose — a serverless instance handles one
   * request at a time, and the pooler multiplexes across instances.
   */
  readonly max?: number;
  /** Seconds an idle connection is kept before the pooler reclaims it. */
  readonly idleTimeout?: number;
  readonly connectTimeout?: number;
}

/**
 * Creates a client. Prefer {@link getSql} in the app; use this directly in tests and scripts that
 * want an isolated pool they can close.
 */
export function createSql(config: DbConfig): Sql {
  return postgres(config.connectionString, {
    max: config.max ?? 4,
    idle_timeout: config.idleTimeout ?? 20,
    connect_timeout: config.connectTimeout ?? 10,
    // `prepare: false` is required by transaction-mode pooling: prepared statements are bound to a
    // backend connection the pooler is free to hand to someone else between statements.
    prepare: false,
    // Timestamps come back as `Date`. The domain treats every instant as UTC (constitution: Locale
    // & time) and renders in Europe/Lisbon at the edge.
    transform: { undefined: null },
    onnotice: () => {},
  }) as Sql;
}

let shared: Sql | undefined;

/**
 * Process-wide client.
 *
 * Cached because a serverless instance is reused across invocations and re-establishing the pool per
 * request is the fastest way to hit the connection ceiling (Risk R8).
 */
export function getSql(config: DbConfig): Sql {
  shared ??= createSql(config);
  return shared;
}

/** Closes the process-wide client. For tests and scripts; the app never needs it. */
export async function closeSharedSql(): Promise<void> {
  if (!shared) return;
  const sql = shared;
  shared = undefined;
  await sql.end({ timeout: 5 });
}
