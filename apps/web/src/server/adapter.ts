import { NextResponse } from 'next/server';
import { z } from 'zod';
import { httpStatusFor, isDomainError } from '@padelmigas/core';
import type { ErrorCode } from '@padelmigas/contracts/common';
import type { Deps } from '@padelmigas/api';
import { getDeps } from './deps.js';

/**
 * The route adapter.
 *
 * Route files under `app/api/v1/**` are capped at three responsibilities — parse the request, call
 * exactly one handler, serialise the result — and this module is where all three live so no route
 * file has to re-implement them. Business branching in a route file is a Principle II violation and
 * is reviewed as such.
 *
 * Two invariants this file owns:
 *  - **No caching of voter-dependent responses.** Any response whose content depends on who is
 *    asking is sent `Cache-Control: no-store`. A cached reveal is Risk R1's exact failure (SC-006).
 *  - **Stable error codes.** Clients branch on `code`; `message` is localisable copy
 *    (contracts/README rule 5). Unrecognised failures become `INTERNAL_ERROR` and never leak an
 *    internal message.
 */

/** Applied to every response whose body depends on the caller's vote state. */
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  // Belt and braces for intermediaries that predate Cache-Control.
  Pragma: 'no-cache',
} as const;

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  issues?: { path: string; message: string }[];
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  issues: readonly { path: string; message: string }[] = [],
  extraHeaders: Readonly<Record<string, string>> = {},
): NextResponse<ErrorBody> {
  const body: ErrorBody = { code, message };
  if (issues.length > 0) body.issues = [...issues];
  return NextResponse.json(body, {
    status: httpStatusFor(code),
    headers: { ...NO_STORE_HEADERS, ...extraHeaders },
  });
}

/** Turns a Zod failure into the same `issues[]` shape the domain uses, so clients see one format. */
function zodIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

/** `['pairs', 10, 'players', 1, 'name']` → `pairs[10].players[1].name` (contracts/README example). */
export function formatPath(path: readonly (string | number)[]): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc.length === 0 ? segment : `${acc}.${segment}`;
  }, '');
}

/**
 * Maps any thrown value to a response.
 *
 * A `DomainError` is an expected outcome and carries its own code. Anything else is a defect: it is
 * logged server-side and answered with a generic 500, because an internal message on the wire is
 * both an information leak and useless to the client.
 */
export function toErrorResponse(error: unknown): NextResponse<ErrorBody> {
  if (isDomainError(error)) {
    return errorResponse(error.code, error.message, error.issues);
  }
  console.error('Unhandled error in route adapter:', error);
  return errorResponse('INTERNAL_ERROR', 'Ocorreu um erro inesperado. Tenta novamente.');
}

export interface JsonSuccess<TBody> {
  readonly body: TBody;
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Runs one handler and serialises the outcome.
 *
 * `parse` is separated from `run` so the adapter can answer a malformed request before any dependency
 * is touched, and so the handler's input type is inferred from the schema rather than restated.
 */
export async function respond<TInput, TOutput>(options: {
  /** Produces the handler input from the request. Throws `ZodError` on a malformed request. */
  readonly parse: () => Promise<TInput> | TInput;
  readonly run: (input: TInput, deps: Deps) => Promise<TOutput>;
  /** Status for the success case. Defaults to 200; creation routes pass 201. */
  readonly status?: number;
  /** Extra response headers, e.g. a freshly minted voter cookie. */
  readonly headers?: Readonly<Record<string, string>>;
}): Promise<NextResponse<TOutput | ErrorBody>> {
  let input: TInput;
  try {
    input = await options.parse();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        'MALFORMED_PAYLOAD',
        'O pedido não tem o formato esperado.',
        zodIssues(error),
      );
    }
    return toErrorResponse(error);
  }

  try {
    const output = await options.run(input, getDeps());
    return NextResponse.json(output, {
      status: options.status ?? 200,
      headers: { ...NO_STORE_HEADERS, ...(options.headers ?? {}) },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Parses a JSON body against a schema.
 *
 * A body that is not JSON at all is reported as a payload problem rather than crashing the route —
 * an organiser pasting a truncated lineup should see a message, not a 500.
 */
export async function jsonBody<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'O corpo do pedido não é JSON válido.',
      },
    ]);
  }
  return schema.parse(raw);
}

/** Parses the query string against a schema. */
export function searchParams<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
): z.infer<TSchema> {
  const url = new URL(request.url);
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}
