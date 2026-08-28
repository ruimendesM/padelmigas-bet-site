import type { ErrorCode, ErrorIssue } from '@padelmigas/contracts/common';

/**
 * Domain errors and their HTTP mapping.
 *
 * The mapping lives here, in the portable core, rather than in the route adapter, so that a
 * standalone Fastify service or a mobile-facing gateway maps the same error to the same status
 * without re-deriving the table (Principle II). The adapter's only job is to read it.
 */

/**
 * A failure the domain knows how to describe.
 *
 * Anything not represented here is a bug, surfaces as `INTERNAL_ERROR`, and must never leak an
 * internal message to the client.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly issues: readonly ErrorIssue[];

  constructor(code: ErrorCode, message: string, issues: readonly ErrorIssue[] = []) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.issues = issues;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** Convenience constructor so handlers read as `throw domainError('ALREADY_VOTED', '...')`. */
export function domainError(
  code: ErrorCode,
  message: string,
  issues: readonly ErrorIssue[] = [],
): DomainError {
  return new DomainError(code, message, issues);
}

/**
 * Error code → HTTP status.
 *
 * Every entry matches contracts/openapi.yaml; the contract tests assert the status per code, so a
 * change here without a change there fails CI.
 */
export const HTTP_STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  // Generic
  NOT_FOUND: 404,
  UNAUTHORISED: 401,
  RATE_LIMITED: 429,
  MALFORMED_PAYLOAD: 400,
  INTERNAL_ERROR: 500,

  // Publishing a lineup
  UNRESOLVED_PLAYERS: 400,
  START_NOT_IN_FUTURE: 400,
  DUPLICATE_PLAYER: 400,
  POINTS_MISMATCH: 400,
  INVALID_GROUP_SIZE: 400,
  // A taken slug is a conflict with existing state, not a malformed payload.
  SLUG_TAKEN: 409,
  NOT_CONFIRMED: 400,

  // Ranking import
  DUPLICATE_MATCH_KEY: 409,

  // Casting a ballot
  INCOMPLETE_BALLOT: 400,
  DUPLICATE_POSITION: 400,
  UNKNOWN_PAIR: 400,
  MISSING_PAIR: 400,
  ALREADY_VOTED: 409,
  // The request is well-formed and the voter is entitled to ask; the window is simply shut.
  VOTING_CLOSED: 422,

  // Reading results
  RESULTS_HIDDEN: 403,
};

export function httpStatusFor(code: ErrorCode): number {
  return HTTP_STATUS_BY_CODE[code];
}

/**
 * Preview and publish report every problem at once (FR-005). Collecting issues into one error keeps
 * that promise structural instead of relying on each caller to remember it.
 */
export class IssueCollector {
  private readonly issues: ErrorIssue[] = [];

  add(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  get isEmpty(): boolean {
    return this.issues.length === 0;
  }

  /** Snapshot of everything collected so far, in the order it was found. */
  all(): readonly ErrorIssue[] {
    return [...this.issues];
  }

  /**
   * Throws a single error carrying every issue. `code` names the dominant problem so a client can
   * still branch on one value; `issues` carries the detail.
   */
  throwIfAny(code: ErrorCode, message: string): void {
    if (this.isEmpty) return;
    throw new DomainError(code, message, this.all());
  }
}
