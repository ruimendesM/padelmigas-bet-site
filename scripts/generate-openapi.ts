/**
 * Generates the committed OpenAPI 3.1 document from the Zod schemas.
 *
 * `contracts/openapi.yaml` is reviewable in the spec but is NOT the source of truth — the schemas
 * are (constitution, Principle III; contracts/README). This script keeps them in step, and
 * `--check` fails CI when someone edits one without the other.
 *
 * Usage:
 *   pnpm generate:openapi          # write the file
 *   pnpm openapi:check             # fail if the committed file is stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import type { ErrorCode } from '../packages/contracts/src/common.js';
import {
  ENDPOINTS as RAW_ENDPOINTS,
  ERROR_SCHEMAS,
  type EndpointDefinition,
} from '../packages/contracts/src/endpoints.js';
import { HTTP_STATUS_BY_CODE } from '../packages/core/src/errors.js';

// `ENDPOINTS` is declared `as const satisfies` so generated types can index it literally. Here we
// only iterate, so widen to the interface — otherwise optional keys absent from some entries are
// unreachable on the narrowed union.
const ENDPOINTS: readonly EndpointDefinition[] = RAW_ENDPOINTS;

const OUTPUT = join(
  process.cwd(),
  'specs',
  '001-group-standings-voting',
  'contracts',
  'openapi.yaml',
);

type JsonObject = Record<string, unknown>;

/**
 * Converts one Zod schema to a JSON Schema fragment.
 *
 * `target: 'openApi3'` keeps `nullable` rather than `type: [x, 'null']`, which is what most OpenAPI
 * tooling still expects, and `$refStrategy: 'none'` inlines rather than emitting `$defs` the
 * component section would then have to host.
 */
function toSchema(schema: z.ZodTypeAny): JsonObject {
  const converted = zodToJsonSchema(schema, {
    target: 'openApi3',
    $refStrategy: 'none',
    errorMessages: false,
  }) as JsonObject;
  delete converted['$schema'];
  return converted;
}

function errorResponses(endpoint: EndpointDefinition): JsonObject {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of endpoint.errors) {
    const status = HTTP_STATUS_BY_CODE[code];
    const bucket = byStatus.get(status);
    if (bucket) bucket.push(code);
    else byStatus.set(status, [code]);
  }

  const responses: JsonObject = {};
  for (const [status, codes] of [...byStatus.entries()].sort((a, b) => a[0] - b[0])) {
    // Endpoints that report every offending entry at once use the richer envelope (FR-005).
    const reportsIssues =
      endpoint.tag === 'admin' || codes.includes('MALFORMED_PAYLOAD') || status === 409;
    responses[String(status)] = {
      description: `\`${codes.join('` | `')}\``,
      content: {
        'application/json': {
          schema: {
            $ref: reportsIssues
              ? '#/components/schemas/ErrorWithIssues'
              : '#/components/schemas/Error',
          },
        },
      },
    };
  }
  return responses;
}

function security(endpoint: EndpointDefinition): unknown[] | undefined {
  switch (endpoint.auth) {
    case 'public':
      return undefined;
    case 'organiser':
      return [{ organiserSession: [] }];
    case 'organiser-or-cron':
      // Either credential is sufficient; OpenAPI expresses OR as separate array entries.
      return [{ organiserSession: [] }, { cronSecret: [] }];
  }
}

function pathParameters(endpoint: EndpointDefinition): JsonObject[] {
  return endpoint.pathParams.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: name.endsWith('Id') ? { type: 'string', format: 'uuid' } : { type: 'string' },
  }));
}

function queryParameters(endpoint: EndpointDefinition): JsonObject[] {
  if (!endpoint.query) return [];
  const schema = toSchema(endpoint.query);
  const properties = (schema['properties'] ?? {}) as Record<string, JsonObject>;
  const required = new Set((schema['required'] as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, propertySchema]: [string, JsonObject]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema: propertySchema,
  }));
}

function operation(endpoint: EndpointDefinition): JsonObject {
  const successHeaders = endpoint.voterDependent
    ? {
        headers: {
          'Cache-Control': {
            description:
              'Always `no-store`: this response depends on who is asking, and a cached reveal ' +
              'would leak results to a visitor who has not voted (SC-006, Risk R1).',
            schema: { type: 'string', example: 'no-store' },
          },
        },
      }
    : {};

  const op: JsonObject = {
    operationId: endpoint.operationId,
    tags: [endpoint.tag],
    summary: endpoint.summary,
    description: `Requirements: ${endpoint.requirements.join(', ')}.`,
    parameters: [...pathParameters(endpoint), ...queryParameters(endpoint)],
    responses: {
      [String(endpoint.successStatus)]: {
        description: endpoint.summary,
        ...successHeaders,
        content: { 'application/json': { schema: toSchema(endpoint.response) } },
      },
      ...errorResponses(endpoint),
    },
  };

  if ((op['parameters'] as unknown[]).length === 0) delete op['parameters'];

  if (endpoint.body) {
    op['requestBody'] = {
      required: true,
      content: { 'application/json': { schema: toSchema(endpoint.body) } },
    };
  }

  const sec = security(endpoint);
  if (sec) op['security'] = sec;

  return op;
}

function document(): JsonObject {
  const paths: JsonObject = {};
  for (const endpoint of ENDPOINTS) {
    const existing = (paths[endpoint.path] ?? {}) as JsonObject;
    existing[endpoint.method.toLowerCase()] = operation(endpoint);
    paths[endpoint.path] = existing;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Padelmigas Bet API',
      version: '1.0.0',
      description:
        'Public voting API for padel tournament group standings.\n\n' +
        'GENERATED from the Zod schemas in packages/contracts by scripts/generate-openapi.ts — ' +
        'edit the schemas, not this file. `pnpm openapi:check` fails CI if the two drift apart.\n\n' +
        'Every response that depends on voter state is sent with `Cache-Control: no-store` ' +
        '(ADR-008). Clients branch on the error `code`, never on `message`, which is localisable ' +
        'copy.',
    },
    servers: [
      {
        url: '/api/v1',
        description:
          'Hosted by apps/web today; detachable to a standalone service without contract change.',
      },
    ],
    tags: [
      { name: 'public', description: 'Anonymous visitors. A voter cookie may be present.' },
      { name: 'admin', description: 'Organiser only.' },
    ],
    paths,
    components: {
      securitySchemes: {
        organiserSession: {
          type: 'apiKey',
          in: 'cookie',
          name: 'pm_admin',
          description:
            'Server-signed organiser session cookie; the anonymous public never holds one.',
        },
        cronSecret: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Shared secret held only by the scheduler, accepted by the rankings-sync route alone ' +
            'so the cron job can run without an organiser session. Never accepted elsewhere.',
        },
      },
      schemas: {
        Error: toSchema(ERROR_SCHEMAS.apiError),
        ErrorWithIssues: toSchema(ERROR_SCHEMAS.apiErrorWithIssues),
      },
    },
  };
}

function render(): string {
  const banner = [
    '# GENERATED FILE — do not edit by hand.',
    '#',
    '# Source of truth: the Zod schemas in packages/contracts (constitution, Principle III).',
    '# Regenerate with `pnpm generate:openapi`; `pnpm openapi:check` fails CI when this file is stale.',
    '',
  ].join('\n');
  return `${banner}${stringify(document(), { lineWidth: 100 })}`;
}

function main(): void {
  const rendered = render();
  const isCheck = process.argv.includes('--check');

  if (!isCheck) {
    writeFileSync(OUTPUT, rendered, 'utf8');
    console.log(`Generated ${OUTPUT} — ${ENDPOINTS.length} endpoints.`);
    return;
  }

  let committed: string;
  try {
    committed = readFileSync(OUTPUT, 'utf8');
  } catch {
    console.error(`${OUTPUT} is missing. Run \`pnpm generate:openapi\`.`);
    process.exit(1);
  }

  if (committed !== rendered) {
    console.error(
      'The committed OpenAPI document does not match the Zod schemas.\n' +
        'Run `pnpm generate:openapi` and commit the result.',
    );
    process.exit(1);
  }

  console.log(`OpenAPI document matches the schemas (${ENDPOINTS.length} endpoints).`);
}

main();
