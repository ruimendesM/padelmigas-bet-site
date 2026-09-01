import { z } from 'zod';
import type { LineupImageInput, LineupImageReader, RawExtractedRow } from '@padelmigas/core';

/**
 * The **only** module in this repository that names a vision provider (ADR-011).
 *
 * It implements the `LineupImageReader` port declared in `packages/core/src/ports`, so swapping
 * Gemini for tesseract.js, a local model, or another hosted one replaces this file and one line in
 * `deps.ts` — nothing in the contract, the handler, the domain or the UI moves. `pnpm boundaries`
 * enforces the direction: `packages/core` cannot reach anything in `apps/`.
 *
 * Three behaviours the design depends on:
 *  - **Fail, never degrade.** An upstream error, a timeout, a non-JSON body, or output that does not
 *    match `responseRows` throws. The handler turns that into `EXTRACTION_FAILED`. A partially
 *    salvaged response is worse than none: it looks like a successful read.
 *  - **Never guess.** The instruction below requires `null` for anything unreadable and forbids
 *    computing a missing total. That is what makes a misread a flagged cell rather than a plausible
 *    wrong number (FR-107).
 *  - **Nothing is kept.** The image is a request body and a base64 string in this function's scope.
 *    It is not stored, not logged, and no part of the provider's response is logged either — an
 *    error message could quote the image's contents (FR-118).
 *
 * The prompt and schema below are the reviewable contract with the provider, documented in
 * `specs/002-lineup-image-import/contracts/extraction-prompt.md`. Keep the two in step.
 */

/**
 * Measured, not guessed (2026-08-31, against a 12-row lineup screenshot with the prompt below).
 *
 * | model                 | latency          | wrong cells |
 * |-----------------------|------------------|-------------|
 * | gemini-3.5-flash-lite | 2.9–3.0 s (4×)   | 0 / 72      |
 * | gemini-3.1-flash-lite | 4.7 s            | 0 / 72      |
 * | gemini-3.6-flash      | 13 s, 54 s, >90 s| 0 / 72      |
 *
 * The reasoning models are as accurate and wildly slower: `gemini-3.6-flash` spent ~1500 thought
 * tokens deliberating over a transcription task and blew the timeout on one run in three. Reading a
 * table needs no deliberation, so the lite model is the right tool — and it keeps SC-102's
 * ten-second budget with room to spare. Re-measure when changing this; the table above is the reason
 * it is not a reasoning model.
 */
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

/** One attempt, then fail. SC-102 allows ten seconds to a draft or a clear failure; a retry would
 * double the worst case, and with one organiser doing this monthly the right retry is manual
 * (research D6). */
const TIMEOUT_MS = 15_000;

/**
 * A failure with a reason that is safe to log.
 *
 * The provider's own message is deliberately not carried: it can quote the request, and nothing
 * derived from the image may reach a log (FR-118). The reason is a fixed code, so an operator can
 * tell a retired model from a timeout without the bytes appearing anywhere.
 */
export class ExtractionFailure extends Error {
  constructor(readonly reason: string) {
    super(`Lineup extraction failed: ${reason}`);
    this.name = 'ExtractionFailure';
  }
}

const INSTRUCTION = `You are reading a screenshot of a padel tournament lineup table. Each row of the table is one pair of players.

The table's columns, in order, are: first player's name, second player's name, first player's ranking points, second player's ranking points, the pair's total points, and the club. Column headers may be in Portuguese (for example "Jogador 1", "Jogador 2", "PTS J1", "PTS J2", "Pontos Total", "Clube") or absent entirely. Ignore any header row, any totals row, and any decoration such as row colouring or borders.

Return one object per data row, in the order the rows appear in the image, top to bottom.

Rules you must follow exactly:

1. Report every value as it appears in the image. Do not correct, translate, reformat, or capitalise names. Keep accents and punctuation exactly as shown.
2. If a value is missing, cut off, or you cannot read it with confidence, return null for that field. Never guess a name and never guess a number.
3. Never compute a value. In particular, if the total points column is unreadable, return null for it — do not add the two player point values together. If the total that is shown does not equal the sum of the two player values, report the total that is shown.
4. Do not reorder, merge, split, or drop rows. If a row is entirely unreadable, still return it, with null in every field.
5. Do not invent rows to make the count even.
6. If the image contains no lineup table at all, return an empty list.

Return only data matching the schema. No commentary.`;

/** The structured-output schema handed to the provider. Mirrors `responseRows` below. */
const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'player1Name',
          'player2Name',
          'player1Points',
          'player2Points',
          'totalPoints',
          'club',
        ],
        properties: {
          player1Name: { type: 'string', nullable: true },
          player2Name: { type: 'string', nullable: true },
          player1Points: { type: 'integer', nullable: true },
          player2Points: { type: 'integer', nullable: true },
          totalPoints: { type: 'integer', nullable: true },
          club: { type: 'string', nullable: true },
        },
      },
    },
  },
} as const;

/**
 * Re-validated on arrival, independently of what the provider promised.
 *
 * `sourceIndex` is deliberately absent: it is assigned from the array position below, so it cannot
 * be hallucinated or duplicated.
 */
const responseRows = z.object({
  rows: z.array(
    z.object({
      player1Name: z.string().nullable(),
      player2Name: z.string().nullable(),
      player1Points: z.number().int().nullable(),
      player2Points: z.number().int().nullable(),
      totalPoints: z.number().int().nullable(),
      club: z.string().nullable(),
    }),
  ),
});

export interface GeminiLineupImageReaderConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly timeoutMs?: number;
}

export function createGeminiLineupImageReader(
  config: GeminiLineupImageReaderConfig,
): LineupImageReader {
  const model = config.model ?? DEFAULT_MODEL;

  return {
    async read(image: LineupImageInput): Promise<readonly RawExtractedRow[]> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? TIMEOUT_MS);

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'content-type': 'application/json',
              // Header rather than a query parameter: a key in a URL ends up in access logs.
              'x-goog-api-key': config.apiKey,
            },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    { text: INSTRUCTION },
                    {
                      inlineData: {
                        mimeType: image.mimeType,
                        data: toBase64(image.bytes),
                      },
                    },
                  ],
                },
              ],
              generationConfig: {
                // Nothing here is a creative task; the table says what it says.
                temperature: 0,
                responseMimeType: 'application/json',
                responseSchema: RESPONSE_SCHEMA,
              },
            }),
          },
        );

        if (!response.ok) {
          // The status alone, never the body: a provider error can echo the request back. A 404 here
          // almost always means the configured model has been retired.
          throw new ExtractionFailure(`upstream-status-${response.status}`);
        }

        const payload: unknown = await response.json();
        const text = firstTextPart(payload);

        let parsed;
        try {
          parsed = responseRows.parse(JSON.parse(text) as unknown);
        } catch {
          throw new ExtractionFailure('response-schema-mismatch');
        }

        return parsed.rows.map((row): RawExtractedRow => ({
          player1Name: row.player1Name,
          player2Name: row.player2Name,
          player1Points: row.player1Points,
          player2Points: row.player2Points,
          totalPoints: row.totalPoints,
          club: row.club,
        }));
      } catch (failure) {
        // One line, content-free, so a misconfiguration is diagnosable from the server log without
        // the image or the provider's echo of it ever being written down.
        const reason =
          failure instanceof ExtractionFailure
            ? failure.reason
            : failure instanceof Error && failure.name === 'AbortError'
              ? 'timeout'
              : 'transport-error';
        console.warn(`Lineup extraction failed (${reason}).`);
        throw failure;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/**
 * Pulls the model's answer out of the response envelope.
 *
 * Narrow on purpose: a response missing the part — a safety block, a truncated generation, an
 * envelope change — throws here rather than being coaxed into something usable.
 */
const envelope = z.object({
  candidates: z
    .array(
      z.object({
        // A part need not carry text: current models interleave reasoning parts that carry only a
        // signature. Requiring `text` on every part rejected perfectly good responses, so the answer
        // is the first part that actually has text.
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })).min(1) }),
      }),
    )
    .min(1),
});

function firstTextPart(payload: unknown): string {
  const parsed = envelope.safeParse(payload);
  const text = parsed.success
    ? parsed.data.candidates
        .flatMap((candidate) => candidate.content.parts)
        .find((part) => part.text !== undefined && part.text.length > 0)?.text
    : undefined;

  if (text === undefined) {
    throw new ExtractionFailure('unusable-response');
  }
  return text;
}

/** Bytes → base64 without `Buffer`, so this file stays runtime-agnostic like the rest of the host. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
