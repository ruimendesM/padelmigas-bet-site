import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError, ApiErrorWithIssues, LineupExtractionDto } from '@padelmigas/contracts';
import type { LineupImageReader, RawExtractedRow } from '@padelmigas/core';
import { MAX_LINEUP_IMAGE_BYTES } from '@padelmigas/contracts';
import { setDeps } from '../../apps/web/src/server/deps.js';
import { POST } from '../../apps/web/app/api/v1/admin/tournaments/extract/route.js';
import { body, current, install, jsonRequest, organiserCookie } from './helpers.js';

/**
 * `POST /api/v1/admin/tournaments/extract` (FR-101, FR-105 – FR-108, FR-116 – FR-119).
 *
 * The reader is stubbed in every case here, deliberately: no test in this repository calls a vision
 * provider (research D10). What is being tested is this endpoint's contract — the success shape and
 * every documented failure code — not a model's accuracy, which is verified by hand against real
 * screenshots (quickstart, SC-103).
 *
 * A code that cannot be produced is a code the organiser will never see when they need it, so all
 * five are asserted reachable, and each is asserted to be *itself* rather than a 500.
 */

const URL = 'http://localhost/api/v1/admin/tournaments/extract';

/** A one-pixel PNG. Content is irrelevant — the reader is stubbed; only size and type are checked. */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function raw(overrides: Partial<RawExtractedRow> = {}): RawExtractedRow {
  return {
    player1Name: 'Afonso Bastos',
    player1Points: 500,
    player2Name: 'Vasco Trindade',
    player2Points: 400,
    totalPoints: 900,
    club: 'Clube Padel Norte',
    ...overrides,
  };
}

/** Installs a reader for this test only, leaving the rest of the container as `install()` built it. */
function withReader(reader: LineupImageReader): void {
  setDeps({ ...current().deps, imageReader: reader });
}

function stubReturning(rows: readonly RawExtractedRow[]): LineupImageReader {
  return { read: vi.fn(async () => rows) };
}

function imageRequest(image: { mimeType: string; dataBase64: string }, cookie?: string): Request {
  return jsonRequest(URL, { image }, cookie === undefined ? {} : { cookie });
}

describe('POST /api/v1/admin/tournaments/extract', () => {
  beforeEach(() => {
    install({ now: new Date('2026-09-01T12:00:00.000Z') });
  });

  it('returns the extracted rows, ordered by pair total descending', async () => {
    withReader(stubReturning([raw({ totalPoints: 800 }), raw({ totalPoints: 1000 })]));

    const response = await POST(
      imageRequest({ mimeType: 'image/png', dataBase64: TINY_PNG }, await organiserCookie()),
    );

    expect(response.status).toBe(200);
    const extraction = await body<LineupExtractionDto>(response);
    expect(extraction.rows.map((row) => row.totalPoints)).toEqual([1000, 800]);
    expect(extraction.rows[0]?.players[0]?.name).toBe('Afonso Bastos');
    expect(extraction.rows[0]?.sourceIndex).toBe(1);
    expect(extraction.warnings).toEqual([]);
  });

  it('passes flags and warnings through, repairing nothing (FR-107)', async () => {
    // One row with an unreadable points value, one whose total disagrees with its two players, and
    // an odd row count — the imperfect screenshot case from the response fixture.
    withReader(
      stubReturning([
        raw({ totalPoints: 1000 }),
        raw({ totalPoints: 900, player2Points: null }),
        raw({ totalPoints: 850, player1Points: 400, player2Points: 400 }),
      ]),
    );

    const extraction = await body<LineupExtractionDto>(
      await POST(
        imageRequest({ mimeType: 'image/png', dataBase64: TINY_PNG }, await organiserCookie()),
      ),
    );

    expect(extraction.warnings).toEqual(['ODD_ROW_COUNT']);
    expect(extraction.rows[1]?.flags).toEqual(['MISSING_POINTS']);
    // The mismatched total is reported as read, not recomputed from 400 + 400.
    expect(extraction.rows[2]?.flags).toEqual(['TOTAL_MISMATCH']);
    expect(extraction.rows[2]?.totalPoints).toBe(850);
    // And the unreadable value stayed unreadable.
    expect(extraction.rows[1]?.players[1]?.points).toBeNull();
  });

  it('reports NO_ROWS_FOUND when the image held no table', async () => {
    withReader(stubReturning([]));

    const extraction = await body<LineupExtractionDto>(
      await POST(
        imageRequest({ mimeType: 'image/png', dataBase64: TINY_PNG }, await organiserCookie()),
      ),
    );

    expect(extraction.rows).toEqual([]);
    expect(extraction.warnings).toEqual(['NO_ROWS_FOUND']);
  });

  it('refuses an unauthenticated caller with UNAUTHORISED', async () => {
    const read = vi.fn(async () => [raw()]);
    withReader({ read });

    const response = await POST(imageRequest({ mimeType: 'image/png', dataBase64: TINY_PNG }));

    expect(response.status).toBe(401);
    expect((await body<ApiError>(response)).code).toBe('UNAUTHORISED');
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller before reading the body (FR-116)', async () => {
    withReader(stubReturning([raw()]));

    // Not JSON at all. The guard must answer UNAUTHORISED rather than MALFORMED_PAYLOAD, so an
    // anonymous caller cannot learn the schema by probing it.
    const response = await POST(
      new Request(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
    );

    expect((await body<ApiError>(response)).code).toBe('UNAUTHORISED');
  });

  it('rejects a body that is not the documented shape with MALFORMED_PAYLOAD', async () => {
    withReader(stubReturning([raw()]));

    const response = await POST(
      jsonRequest(URL, { image: {} }, { cookie: await organiserCookie() }),
    );

    expect(response.status).toBe(400);
    expect((await body<ApiError>(response)).code).toBe('MALFORMED_PAYLOAD');
  });

  it('rejects invalid base64 with MALFORMED_PAYLOAD', async () => {
    withReader(stubReturning([raw()]));

    const response = await POST(
      imageRequest(
        { mimeType: 'image/png', dataBase64: '!!! not base64 !!!' },
        await organiserCookie(),
      ),
    );

    expect(response.status).toBe(400);
    expect((await body<ApiError>(response)).code).toBe('MALFORMED_PAYLOAD');
  });

  it('rejects an unaccepted image type without calling the reader (FR-117)', async () => {
    const read = vi.fn(async () => [raw()]);
    withReader({ read });

    const response = await POST(
      imageRequest({ mimeType: 'application/pdf', dataBase64: TINY_PNG }, await organiserCookie()),
    );

    expect(response.status).toBe(400);
    expect((await body<ApiError>(response)).code).toBe('MALFORMED_PAYLOAD');
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects an over-cap image with PAYLOAD_TOO_LARGE, without calling the reader', async () => {
    const read = vi.fn(async () => [raw()]);
    withReader({ read });

    // One base64 character per 6 bits: 4/3 characters per byte, plus a margin over the cap.
    const oversized = 'A'.repeat(Math.ceil((MAX_LINEUP_IMAGE_BYTES * 4) / 3) + 1024);
    const response = await POST(
      imageRequest({ mimeType: 'image/png', dataBase64: oversized }, await organiserCookie()),
    );

    expect(response.status).toBe(413);
    const failure = await body<ApiErrorWithIssues>(response);
    expect(failure.code).toBe('PAYLOAD_TOO_LARGE');
    expect(failure.issues?.[0]?.message).toContain('5');
    expect(read).not.toHaveBeenCalled();
  });

  it('answers EXTRACTION_UNAVAILABLE when no reader is configured (FR-119, FR-120)', async () => {
    // The default container from install() has no imageReader — the shape of a deployment with no
    // API key. This must be a clean 503, never an INTERNAL_ERROR.
    const response = await POST(
      imageRequest({ mimeType: 'image/png', dataBase64: TINY_PNG }, await organiserCookie()),
    );

    expect(response.status).toBe(503);
    expect((await body<ApiError>(response)).code).toBe('EXTRACTION_UNAVAILABLE');
  });

  it('answers EXTRACTION_FAILED when the reader throws', async () => {
    withReader({
      read: vi.fn(async () => {
        throw new Error('upstream exploded');
      }),
    });

    const response = await POST(
      imageRequest({ mimeType: 'image/png', dataBase64: TINY_PNG }, await organiserCookie()),
    );

    expect(response.status).toBe(502);
    const failure = await body<ApiError>(response);
    expect(failure.code).toBe('EXTRACTION_FAILED');
    // The upstream message never reaches the client: it can quote the image's contents (FR-118).
    expect(failure.message).not.toContain('upstream exploded');
  });

  it('answers EXTRACTION_FAILED when the reader times out', async () => {
    withReader({
      read: vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }),
    });

    const response = await POST(
      imageRequest({ mimeType: 'image/png', dataBase64: TINY_PNG }, await organiserCookie()),
    );

    expect(response.status).toBe(502);
    expect((await body<ApiError>(response)).code).toBe('EXTRACTION_FAILED');
  });

  it('never echoes the uploaded image back (FR-118)', async () => {
    withReader(stubReturning([raw(), raw({ totalPoints: 800 })]));

    const response = await POST(
      imageRequest({ mimeType: 'image/png', dataBase64: TINY_PNG }, await organiserCookie()),
    );
    const serialised = JSON.stringify(await response.json());

    expect(serialised).not.toContain(TINY_PNG);
    expect(serialised).not.toContain(TINY_PNG.slice(0, 32));
  });
});
