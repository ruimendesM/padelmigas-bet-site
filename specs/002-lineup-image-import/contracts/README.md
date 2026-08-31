# Contracts: Lineup Image Import

**Source of truth**: the Zod schemas in `packages/contracts`. This feature is **additive to v1** — it
adds one endpoint and three error codes, and renames or removes nothing. The committed
`specs/001-group-standings-voting/contracts/openapi.yaml` is regenerated to include the new endpoint
by `pnpm generate:openapi`; there is no second OpenAPI document.

## Files

| File | Purpose |
|---|---|
| `extraction-response.example.json` | A twelve-row extraction result with two deliberately imperfect rows — the response fixture the contract test and the admin-page tests use |
| `extraction-prompt.md` | The instruction and response schema handed to the extraction provider. Committed rather than embedded in the adapter so a change to extraction behaviour is a reviewable diff (research D9) |

## The new endpoint

| Method | Path | Auth | Requirements |
|---|---|---|---|
| POST | `/api/v1/admin/tournaments/extract` | organiser session | FR-101, FR-102, FR-105 – FR-108, FR-116 – FR-119 |

Registered in `packages/contracts/src/endpoints.ts` as `operationId: 'extractLineup'`,
`tag: 'admin'`, `auth: 'organiser'`, `successStatus: 200`, `voterDependent: false`.

### Request

```jsonc
{
  "image": {
    "mimeType": "image/png",       // or image/jpeg, image/webp — nothing else
    "dataBase64": "iVBORw0KGgo…"   // no data: prefix; ≤ 5 MB decoded
  }
}
```

### Response

```jsonc
{
  "rows": [
    {
      "sourceIndex": 0,
      "players": [
        { "name": "Afonso Bastos", "points": 533 },
        { "name": "Vasco Trindade", "points": 660 }
      ],
      "totalPoints": 1193,
      "club": "Clube Padel Norte",
      "flags": []
    }
  ],
  "warnings": []
}
```

`flags` values: `MISSING_NAME`, `MISSING_POINTS`, `MISSING_CLUB`, `TOTAL_MISMATCH`.
`warnings` values: `NO_ROWS_FOUND`, `ODD_ROW_COUNT`.

Rows are ordered by `totalPoints` descending; rows without a total come last. `sourceIndex` keeps
each row's position in the image so an issue can point back at what was uploaded.

### Documented failures

Each is asserted reachable by the contract test, per the constitution's contract-test rule.

| Code | HTTP | Cause |
|---|---|---|
| `UNAUTHORISED` | 401 | No organiser session. Checked **before** the body is read, so an unauthenticated caller learns nothing about the schema |
| `MALFORMED_PAYLOAD` | 400 | Body fails the schema — missing `image`, invalid base64 |
| `PAYLOAD_TOO_LARGE` | 413 | Decoded image over 5 MB, or an unaccepted `mimeType`. The issue names the limit or the accepted types |
| `EXTRACTION_UNAVAILABLE` | 503 | No reader is configured on this deployment. Distinct from a failed read, because the remedy differs (FR-119) |
| `EXTRACTION_FAILED` | 502 | The reader ran and produced nothing usable: upstream error, 15 s timeout, non-JSON, or output failing the row schema |

## Rules this endpoint adds to the contract

Rules 1–7 in [feature 001's contract README](../../001-group-standings-voting/contracts/README.md)
continue to bind. This feature adds three:

8. **Extraction is a suggestion, never an authority.** Nothing this endpoint returns is trusted by
   any later step. Preview and publish re-validate the submitted draft exactly as they do a
   hand-typed lineup (FR-112). No path from this endpoint writes to the database.
9. **The image is transient.** It is never persisted, never logged, never echoed in an error message
   or issue, and never reaches any store (FR-118). Only data already public on the club's ranking
   sheet may be sent to the extraction provider.
10. **Absence of extraction is a normal state.** A deployment with no reader configured is fully
    functional; this endpoint answers `EXTRACTION_UNAVAILABLE` and the hand-entry path is unaffected
    (FR-120). A missing key must never surface as `INTERNAL_ERROR`.
