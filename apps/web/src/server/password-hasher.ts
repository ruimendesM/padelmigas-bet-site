import { hash, verify } from '@node-rs/argon2';
import type { PasswordHasher } from '@padelmigas/core';
import { ARGON2_OPTIONS } from './argon2-options.js';

/**
 * argon2id for voter-account passwords (feature 004, FR-306, research R7).
 *
 * Same parameters as the organiser password, so the cost of a sign-in is known and a hash made by
 * either path verifies under the other's options. Lives in the host because `@node-rs/argon2` is a
 * native module: `packages/core` and `packages/api` only see the `PasswordHasher` port.
 */
export const argon2PasswordHasher: PasswordHasher = {
  async hash(plain) {
    return hash(plain, ARGON2_OPTIONS);
  },

  async verify(stored, plain) {
    try {
      return await verify(stored, plain, ARGON2_OPTIONS);
    } catch {
      // A malformed stored hash is "wrong password", never a 500 that tells a caller something.
      return false;
    }
  },
};
