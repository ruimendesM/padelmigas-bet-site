/**
 * Produces the argon2id hash for `ADMIN_PASSWORD_HASH` (FR-006).
 *
 * The organiser password is never stored, only its hash, and the hash is generated here rather than
 * by hand so the parameters match `apps/web/src/server/admin-auth.ts` exactly.
 *
 *   pnpm tsx scripts/hash-admin-password.ts 'the password'
 */
import { hash } from '@node-rs/argon2';
import { ARGON2_OPTIONS } from '../apps/web/src/server/argon2-options.js';

async function main(): Promise<void> {
  const password = process.argv[2];
  if (!password) {
    console.error("Usage: pnpm tsx scripts/hash-admin-password.ts 'the password'");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('Refusing to hash a password shorter than 12 characters.');
    process.exit(1);
  }
  console.log(await hash(password, ARGON2_OPTIONS));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
