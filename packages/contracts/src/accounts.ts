import { z } from 'zod';
import { accountId, isoInstant } from './common.js';

/**
 * Optional voter accounts (feature 004, FR-303 – FR-322).
 *
 * A username and a password, nothing else (FR-305). The account holder is only ever told their own
 * username: no account id, no voter id (FR-022) and never a hash (FR-306). The organiser search is
 * the one place an account id appears, because the reset route needs it.
 */

/** Username rules, shared with `core/accounts.normaliseUsername` (FR-303). */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** Trimmed and lower-cased before the rules apply, so `Rui.M` and `rui.m` are the same account. */
export const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(USERNAME_MIN, `O nome de utilizador tem de ter pelo menos ${USERNAME_MIN} caracteres.`)
  .max(USERNAME_MAX, `O nome de utilizador tem no máximo ${USERNAME_MAX} caracteres.`)
  .regex(
    USERNAME_PATTERN,
    'O nome de utilizador só pode ter letras minúsculas, números, ponto, hífen ou sublinhado.',
  );

export const password = z
  .string()
  .min(PASSWORD_MIN, `A palavra-passe tem de ter pelo menos ${PASSWORD_MIN} caracteres.`)
  .max(PASSWORD_MAX, `A palavra-passe tem no máximo ${PASSWORD_MAX} caracteres.`);

export const account = z.object({
  username: z.string(),
});
export type AccountDto = z.infer<typeof account>;

export const accountResponse = z.object({
  account,
});
export type AccountResponse = z.infer<typeof accountResponse>;

export const registerRequest = z.object({
  username,
  password,
});
export type RegisterRequestDto = z.infer<typeof registerRequest>;

/**
 * Sign-in. `newPassword` is only meaningful after an organiser reset: a pending temporary password
 * never yields a session on its own, so the same call carries the replacement (FR-321, research R5).
 *
 * The username is not held to the registration rules here — a malformed username simply matches no
 * account and gets the same answer as a wrong password (FR-314).
 */
export const signInRequest = z.object({
  username: z.string().trim().toLowerCase().min(1).max(200),
  password: z.string().min(1).max(PASSWORD_MAX),
  newPassword: password.optional(),
});
export type SignInRequestDto = z.infer<typeof signInRequest>;

export const signOutResponse = z.object({
  signedOut: z.literal(true),
});
export type SignOutResponse = z.infer<typeof signOutResponse>;

export const changePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX),
  newPassword: password,
});
export type ChangePasswordRequestDto = z.infer<typeof changePasswordRequest>;

// ---------------------------------------------------------------------------------------------
// Organiser
// ---------------------------------------------------------------------------------------------

export const accountSearchQuery = z.object({
  q: z.string().trim().toLowerCase().min(1).max(USERNAME_MAX),
});
export type AccountSearchQuery = z.infer<typeof accountSearchQuery>;

export const accountSummary = z.object({
  id: accountId,
  username: z.string(),
  createdAt: isoInstant,
  /** An unexpired temporary password is waiting to be replaced (FR-321). */
  temporaryPasswordPending: z.boolean(),
});
export type AccountSummaryDto = z.infer<typeof accountSummary>;

export const accountSearchResponse = z.object({
  accounts: z.array(accountSummary),
});
export type AccountSearchResponse = z.infer<typeof accountSearchResponse>;

/** The only response that ever carries the temporary password; it cannot be fetched again (FR-320). */
export const passwordResetResponse = z.object({
  temporaryPassword: z.string(),
  expiresAt: isoInstant,
});
export type PasswordResetResponse = z.infer<typeof passwordResetResponse>;
