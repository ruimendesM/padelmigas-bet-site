import type { z } from 'zod';
import { apiError, apiErrorWithIssues, type ErrorCode } from './common.js';
import { ballotSubmission, castBallotResponse, tournamentDetail } from './ballots.js';
import {
  accountResponse,
  accountSearchQuery,
  accountSearchResponse,
  changePasswordRequest,
  passwordResetResponse,
  registerRequest,
  signInRequest,
  signOutResponse,
} from './accounts.js';
import { playerDetail } from './players.js';
import { groupResults } from './results.js';
import {
  extractLineupBody,
  lineupExtraction,
  lineupPayload,
  lineupPreview,
  publishRequest,
  rankingsSyncResponse,
  replacementPreview,
  tournamentListQuery,
  tournamentListResponse,
} from './tournaments.js';

/**
 * The endpoint registry — the machine-readable half of the contract.
 *
 * `scripts/generate-client.ts` emits `packages/client` from this, and
 * `scripts/generate-openapi.ts` emits the committed OpenAPI document from it. Because both read the
 * same table, a route cannot exist in the client but not the spec, and neither can drift from the
 * Zod schemas that validate the real request (constitution, Principle III).
 *
 * Adding an endpoint means adding an entry here. Forgetting to is caught by `pnpm openapi:check`.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Who may call an endpoint. Mirrors contracts/README rule 7 exactly. */
export type AuthMode =
  /** Public. A voter cookie may be present and changes the answer, but is never required. */
  | 'public'
  /** Requires the signed organiser session cookie. */
  | 'organiser'
  /** Organiser session OR bearer CRON_SECRET — accepted by the rankings-sync route alone. */
  | 'organiser-or-cron'
  /** Requires the signed voter-account session cookie (feature 004). */
  | 'account';

export interface EndpointDefinition {
  readonly operationId: string;
  readonly method: HttpMethod;
  /** Path relative to `/api/v1`, with `{param}` placeholders. */
  readonly path: string;
  readonly summary: string;
  readonly auth: AuthMode;
  readonly tag: 'public' | 'admin' | 'account';
  /** Path parameter names, in order of appearance. */
  readonly pathParams: readonly string[];
  readonly query?: z.ZodTypeAny;
  readonly body?: z.ZodTypeAny;
  readonly response: z.ZodTypeAny;
  readonly successStatus: 200 | 201;
  /**
   * Every documented failure code. The contract tests assert each one is reachable, so this list is
   * a checklist rather than documentation (constitution: Contract tests).
   */
  readonly errors: readonly ErrorCode[];
  /**
   * Whether the response depends on who is asking. `true` forces `Cache-Control: no-store`; a cached
   * reveal is Risk R1's exact failure mode (SC-006).
   */
  readonly voterDependent: boolean;
  /** Requirement ids this endpoint serves, kept next to the definition so traceability survives. */
  readonly requirements: readonly string[];
}

export const ENDPOINTS = [
  {
    operationId: 'listTournaments',
    method: 'GET',
    path: '/tournaments',
    summary: 'List published tournaments',
    auth: 'public',
    tag: 'public',
    pathParams: [],
    query: tournamentListQuery,
    response: tournamentListResponse,
    successStatus: 200,
    errors: ['MALFORMED_PAYLOAD'],
    // The list carries only tournament-level ballot totals, so it is the same for everyone.
    voterDependent: false,
    requirements: ['FR-023'],
  },
  {
    operationId: 'getTournamentDetail',
    method: 'GET',
    path: '/tournaments/{slug}',
    summary:
      "Tournament detail with groups, pairs, the caller's vote state, and results where revealed",
    auth: 'public',
    tag: 'public',
    pathParams: ['slug'],
    response: tournamentDetail,
    successStatus: 200,
    errors: ['NOT_FOUND'],
    voterDependent: true,
    requirements: ['FR-014', 'FR-015', 'FR-020', 'FR-021'],
  },
  {
    operationId: 'castBallot',
    method: 'POST',
    path: '/groups/{groupId}/ballots',
    summary: "Cast this voter's single ballot for a group",
    auth: 'public',
    tag: 'public',
    pathParams: ['groupId'],
    body: ballotSubmission,
    response: castBallotResponse,
    successStatus: 201,
    errors: [
      'INCOMPLETE_BALLOT',
      'DUPLICATE_POSITION',
      'UNKNOWN_PAIR',
      'MISSING_PAIR',
      'ALREADY_VOTED',
      'VOTING_CLOSED',
      'NOT_FOUND',
      'RATE_LIMITED',
      'MALFORMED_PAYLOAD',
    ],
    voterDependent: true,
    requirements: ['FR-009', 'FR-010', 'FR-011', 'FR-012', 'FR-013', 'SC-005'],
  },
  {
    operationId: 'getGroupResults',
    method: 'GET',
    path: '/groups/{groupId}/results',
    summary: 'Crowd results for one group, subject to the reveal gate',
    auth: 'public',
    tag: 'public',
    pathParams: ['groupId'],
    response: groupResults,
    successStatus: 200,
    errors: ['RESULTS_HIDDEN', 'NOT_FOUND'],
    voterDependent: true,
    requirements: ['FR-016', 'FR-017', 'FR-018', 'FR-019', 'FR-020', 'FR-021'],
  },
  {
    operationId: 'getPlayer',
    method: 'GET',
    path: '/players/{playerId}',
    summary: 'A player and every tournament appearance',
    auth: 'public',
    tag: 'public',
    pathParams: ['playerId'],
    response: playerDetail,
    successStatus: 200,
    errors: ['NOT_FOUND'],
    voterDependent: false,
    requirements: ['FR-025'],
  },
  {
    operationId: 'previewLineup',
    method: 'POST',
    path: '/admin/tournaments/preview',
    summary: 'Validate a lineup payload and return the derived tournament without persisting it',
    auth: 'organiser',
    tag: 'admin',
    pathParams: [],
    body: lineupPayload,
    response: lineupPreview,
    successStatus: 200,
    errors: [
      'UNRESOLVED_PLAYERS',
      'MALFORMED_PAYLOAD',
      'START_NOT_IN_FUTURE',
      'DUPLICATE_PLAYER',
      'POINTS_MISMATCH',
      'INVALID_GROUP_SIZE',
      'SLUG_TAKEN',
      'UNAUTHORISED',
    ],
    voterDependent: false,
    requirements: ['FR-001', 'FR-002', 'FR-003', 'FR-004', 'FR-005'],
  },
  {
    operationId: 'extractLineup',
    method: 'POST',
    path: '/admin/tournaments/extract',
    summary: 'Read a lineup screenshot and return candidate rows with suspect values flagged',
    auth: 'organiser',
    tag: 'admin',
    pathParams: [],
    body: extractLineupBody,
    response: lineupExtraction,
    successStatus: 200,
    errors: [
      'MALFORMED_PAYLOAD',
      'PAYLOAD_TOO_LARGE',
      'EXTRACTION_UNAVAILABLE',
      'EXTRACTION_FAILED',
      'UNAUTHORISED',
    ],
    // Nothing here depends on the caller beyond being the organiser, and nothing is cacheable
    // anyway: the request body is a different image every time.
    voterDependent: false,
    requirements: [
      'FR-101',
      'FR-102',
      'FR-105',
      'FR-106',
      'FR-107',
      'FR-108',
      'FR-116',
      'FR-117',
      'FR-118',
      'FR-119',
    ],
  },
  {
    operationId: 'publishTournament',
    method: 'POST',
    path: '/admin/tournaments',
    summary: 'Publish a previously previewed lineup',
    auth: 'organiser',
    tag: 'admin',
    pathParams: [],
    body: publishRequest,
    response: tournamentDetail,
    successStatus: 201,
    errors: [
      'UNRESOLVED_PLAYERS',
      'MALFORMED_PAYLOAD',
      'START_NOT_IN_FUTURE',
      'DUPLICATE_PLAYER',
      'POINTS_MISMATCH',
      'INVALID_GROUP_SIZE',
      'NOT_CONFIRMED',
      'SLUG_TAKEN',
      'UNAUTHORISED',
    ],
    voterDependent: false,
    requirements: ['FR-002', 'FR-006', 'FR-007', 'FR-008'],
  },
  {
    operationId: 'previewReplacement',
    method: 'POST',
    path: '/admin/tournaments/{slug}/replace/preview',
    summary:
      'Validate a corrected lineup for an open tournament and show which groups keep their votes',
    auth: 'organiser',
    tag: 'admin',
    pathParams: ['slug'],
    body: lineupPayload,
    response: replacementPreview,
    successStatus: 200,
    errors: [
      'NOT_FOUND',
      'NOT_REPLACEABLE',
      'UNRESOLVED_PLAYERS',
      'MALFORMED_PAYLOAD',
      'START_NOT_IN_FUTURE',
      'DUPLICATE_PLAYER',
      'POINTS_MISMATCH',
      'INVALID_GROUP_SIZE',
      'UNAUTHORISED',
    ],
    voterDependent: false,
    requirements: ['FR-201', 'FR-202', 'FR-203', 'FR-206'],
  },
  {
    operationId: 'replaceTournament',
    method: 'POST',
    path: '/admin/tournaments/{slug}/replace',
    summary:
      'Invalidate an open tournament and publish its corrected lineup at the same address, carrying over unchanged groups',
    auth: 'organiser',
    tag: 'admin',
    pathParams: ['slug'],
    body: publishRequest,
    response: tournamentDetail,
    successStatus: 201,
    errors: [
      'NOT_FOUND',
      'NOT_REPLACEABLE',
      'UNRESOLVED_PLAYERS',
      'MALFORMED_PAYLOAD',
      'START_NOT_IN_FUTURE',
      'DUPLICATE_PLAYER',
      'POINTS_MISMATCH',
      'INVALID_GROUP_SIZE',
      'NOT_CONFIRMED',
      'UNAUTHORISED',
    ],
    voterDependent: false,
    requirements: ['FR-204', 'FR-205', 'FR-207', 'FR-208', 'FR-209', 'FR-210'],
  },
  {
    operationId: 'syncRankings',
    method: 'POST',
    path: '/admin/rankings/sync',
    summary: 'Import the public ranking sheet into players and rating snapshots',
    auth: 'organiser-or-cron',
    tag: 'admin',
    pathParams: [],
    response: rankingsSyncResponse,
    successStatus: 200,
    // `MALFORMED_PAYLOAD` is the sheet changing shape: a missing `ID` or `Nome`, or a column C that
    // is not points (FR-027). It was always possible and is now documented.
    errors: ['DUPLICATE_MATCH_KEY', 'MALFORMED_PAYLOAD', 'UNAUTHORISED'],
    voterDependent: false,
    requirements: ['FR-004', 'FR-007', 'FR-027'],
  },
  {
    operationId: 'register',
    method: 'POST',
    path: '/account',
    summary: 'Create a voter account and sign in on this device',
    auth: 'public',
    tag: 'account',
    pathParams: [],
    body: registerRequest,
    response: accountResponse,
    successStatus: 201,
    errors: ['MALFORMED_PAYLOAD', 'USERNAME_TAKEN', 'RATE_LIMITED'],
    voterDependent: true,
    requirements: ['FR-303', 'FR-304', 'FR-305', 'FR-307', 'FR-309', 'FR-317'],
  },
  {
    operationId: 'getAccount',
    method: 'GET',
    path: '/account',
    summary: 'The signed-in account on this device',
    auth: 'account',
    tag: 'account',
    pathParams: [],
    response: accountResponse,
    successStatus: 200,
    errors: ['UNAUTHORISED'],
    voterDependent: true,
    requirements: ['FR-322'],
  },
  {
    operationId: 'signIn',
    method: 'POST',
    path: '/account/session',
    summary:
      "Sign in, merging this device's logged-out ballots into the account, and set a new password after a reset",
    auth: 'public',
    tag: 'account',
    pathParams: [],
    body: signInRequest,
    response: accountResponse,
    successStatus: 200,
    errors: [
      'MALFORMED_PAYLOAD',
      'INVALID_CREDENTIALS',
      'PASSWORD_CHANGE_REQUIRED',
      'RATE_LIMITED',
    ],
    voterDependent: true,
    requirements: ['FR-310', 'FR-311', 'FR-312', 'FR-313', 'FR-314', 'FR-317', 'FR-321'],
  },
  {
    operationId: 'signOut',
    method: 'DELETE',
    path: '/account/session',
    summary: 'Sign out and return this device to a new logged-out visitor',
    auth: 'public',
    tag: 'account',
    pathParams: [],
    response: signOutResponse,
    successStatus: 200,
    errors: [],
    voterDependent: true,
    requirements: ['FR-316'],
  },
  {
    operationId: 'changePassword',
    method: 'PUT',
    path: '/account/password',
    summary: 'Change the password, signing out every other device',
    auth: 'account',
    tag: 'account',
    pathParams: [],
    body: changePasswordRequest,
    response: accountResponse,
    successStatus: 200,
    errors: ['MALFORMED_PAYLOAD', 'INVALID_CREDENTIALS', 'UNAUTHORISED'],
    voterDependent: true,
    requirements: ['FR-318'],
  },
  {
    operationId: 'searchAccounts',
    method: 'GET',
    path: '/admin/accounts',
    summary: 'Find voter accounts by part of a username',
    auth: 'organiser',
    tag: 'admin',
    pathParams: [],
    query: accountSearchQuery,
    response: accountSearchResponse,
    successStatus: 200,
    errors: ['MALFORMED_PAYLOAD', 'UNAUTHORISED'],
    voterDependent: false,
    requirements: ['FR-319'],
  },
  {
    operationId: 'resetAccountPassword',
    method: 'POST',
    path: '/admin/accounts/{accountId}/password-reset',
    summary: 'Issue a one-time temporary password and sign the account out everywhere',
    auth: 'organiser',
    tag: 'admin',
    pathParams: ['accountId'],
    response: passwordResetResponse,
    successStatus: 201,
    errors: ['NOT_FOUND', 'UNAUTHORISED'],
    // Not voter-dependent, but the body is a secret shown once: never cache it.
    voterDependent: true,
    requirements: ['FR-319', 'FR-320'],
  },
] as const satisfies readonly EndpointDefinition[];

export type Endpoint = (typeof ENDPOINTS)[number];
export type OperationId = Endpoint['operationId'];

/** The error envelopes, exported so both generators reference one definition. */
export const ERROR_SCHEMAS = { apiError, apiErrorWithIssues } as const;

export function endpointByOperationId(operationId: OperationId): Endpoint {
  const found = ENDPOINTS.find((e) => e.operationId === operationId);
  if (!found) throw new Error(`Unknown operationId: ${operationId}`);
  return found;
}
