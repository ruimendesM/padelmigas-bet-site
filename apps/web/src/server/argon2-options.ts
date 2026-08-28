/**
 * argon2id parameters for the organiser password (FR-006).
 *
 * Shared by the verifier and by `scripts/hash-admin-password.ts` so a hash generated on the command
 * line always verifies against the running app. OWASP's current minimum for argon2id is 19 MiB with
 * two iterations, which is also cheap enough for a serverless cold start on a single admin login.
 *
 * `algorithm: 2` is `Algorithm.Argon2id`. The numeric literal is used rather than the enum because
 * `@node-rs/argon2` declares it as an ambient const enum, which `verbatimModuleSyntax` cannot import
 * at runtime.
 */
export const ARGON2_OPTIONS = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
