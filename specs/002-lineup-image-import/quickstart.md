# Quickstart: Lineup Image Import

How to run this feature and how to prove it works. Assumes the base setup in
[the repository README](../../README.md) is done — dependencies installed, `.env.local` filled,
schema applied, ranking imported.

## Configuration

One new optional variable, plus one optional override:

```bash
# apps/web/.env.local
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash-lite   # optional; the adapter has a default
```

`GEMINI_API_KEY` is **optional by design** (FR-120, research D5). With it absent the app runs
normally, the upload control explains that extraction is unavailable, and the hand-entry path is
untouched. A missing key must never produce a 500.

Get a key from Google AI Studio's free tier. It is server-only: it must never be prefixed
`NEXT_PUBLIC_`, and `apps/web/src/env.ts` is the only module that reads it.

## Run it

```bash
pnpm dev
```

Sign in at `/admin` with the organiser password.

## Validate

### V1 — A clean import end to end (FR-101 – FR-104, SC-101, SC-106)

1. Choose a screenshot of a twelve-pair lineup table.
2. Within ten seconds the draft table shows twelve rows, each with two names, two point values, a
   total and a club, ordered by total descending (SC-102).
3. Confirm exactly two fields are empty and required: **Nome** and **Início**. Nothing the image
   supplied is asked for again.
4. Fill both. Request the preview. It behaves exactly as for a hand-typed lineup — two groups of six,
   every player matched against the ranking list.
5. Publish. The tournament appears on the public site.

Count what you typed: two values, not sixty (SC-106).

### V2 — Correcting a bad read (FR-105 – FR-109, SC-104)

Use a deliberately poor screenshot — heavily compressed, or cropped mid-column.

1. Confirm partly unreadable rows still appear, with empty cells rather than invented values.
2. Confirm each suspect cell carries a stated reason, and that cells that read correctly carry none.
3. Confirm a row whose total disagrees with the sum of its two players is flagged, keeps the total as
   read, and does not block progress.
4. Correct a flagged cell. Its flag clears without re-uploading (FR-109).
5. Leave one required cell empty and request the preview: it is refused, naming the row (FR-110).

### V3 — Extraction unavailable (FR-119, FR-120)

```bash
# with GEMINI_API_KEY unset or empty
pnpm dev
```

1. The app starts. Every other page works.
2. Attempting an upload reports that extraction is unavailable — wording distinct from "the image
   could not be read".
3. Complete a publish through the hand-entry path. It works unchanged.

### V4 — Refusals before any upstream call (FR-116, FR-117)

1. Sign out. `POST /api/v1/admin/tournaments/extract` answers `UNAUTHORISED`, and does so before
   parsing the body.
2. Upload a PDF, or an image over 5 MB. The response is `PAYLOAD_TOO_LARGE`, and the issue names the
   accepted types or the limit. Confirm in the network log that no upstream call was made.

### V5 — Nothing is kept (FR-118, FR-121, SC-107)

1. Run an import.
2. Search the server logs for the base64 body, the mime type, and any provider response. Nothing.
3. Inspect the database. No new row exists until publish, and no row anywhere references the image.
4. Reload the admin page mid-draft. The browser warns first; after reloading, the draft is gone and
   no server state remains.

### V6 — Grouping and identity are unchanged (FR-113, FR-114)

1. Import a lineup where the club column changes partway down, in a place that does not line up with
   a group boundary. Confirm groups still follow total points descending, in sixes.
2. Import a lineup containing a name absent from the ranking list. Confirm the preview refuses and
   names it, and that no player row was created.

## Automated checks

```bash
pnpm test:unit
```

Covers `packages/core/src/lineup-extraction` — flag derivation, ordering, normalisation, the empty
and odd-count warnings — at 100% branch coverage, and the pure draft transitions in
`packages/ui-logic`.

```bash
pnpm test:contract
```

Drives `POST /api/v1/admin/tournaments/extract` against a real Postgres with a stubbed reader:
the success shape plus every documented failure code — `UNAUTHORISED`, `MALFORMED_PAYLOAD`,
`PAYLOAD_TOO_LARGE`, `EXTRACTION_UNAVAILABLE`, `EXTRACTION_FAILED`.

```bash
pnpm test:e2e
```

Drives upload → draft → correct a flagged cell → preview → publish, with the reader stubbed and a
committed fixture image.

```bash
pnpm boundaries && pnpm openapi:check && pnpm typecheck && pnpm lint
```

`boundaries` proves `packages/core` cannot reach the provider adapter; `openapi:check` proves the new
endpoint was registered in `ENDPOINTS` rather than only implemented.

**No automated test calls the real extraction provider** (research D10). CI needs no API key.

## When extraction fails

`EXTRACTION_FAILED` is deliberately content-free on the wire, so the reason is in the server log as a
one-line, image-free code:

| Log line | Meaning | Fix |
|---|---|---|
| `upstream-status-404` | The configured model id no longer exists — Google retires them | Set `GEMINI_MODEL` to a current id, or update the adapter's default |
| `upstream-status-401` / `403` | Key rejected or restricted | Check the key, and any API restrictions on it |
| `upstream-status-429` | Free-tier rate limit | Wait, then retry |
| `timeout` | No answer within 15 s | Retry; try a smaller image |
| `response-schema-mismatch` | The model answered, but not in the required shape | Check the prompt and schema in `contracts/extraction-prompt.md` |
| `unusable-response` | The response carried no text part at all — a safety block or a truncated generation | Try another image |

## What is checked by hand, not in CI

SC-103 — at least 95% of the values in a legible screenshot extracted correctly — is a property of
the provider, not of this code. Verify it when changing the model, the prompt, or the provider: run
three real screenshots through V1 and count corrected cells against total cells.
