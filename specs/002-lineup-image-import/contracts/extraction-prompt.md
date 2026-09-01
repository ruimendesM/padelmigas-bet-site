# Extraction prompt and response schema

This is the contract between the product and whatever reads the image. It is committed here rather
than embedded as a string literal in `apps/web/src/server/lineup-image-reader.ts`, so that a change
to extraction behaviour arrives as a reviewable diff (research D9). The adapter imports these
constants; it does not restate them.

The rules below exist to make the output *flaggable*. A model that fills a gap with a plausible
number produces an error nothing downstream can detect; a model that returns `null` produces a
flagged cell the organiser fixes in seconds (research D3).

## Instruction

> You are reading a screenshot of a padel tournament lineup table. Each row of the table is one pair
> of players.
>
> The table's columns, in order, are: first player's name, second player's name, first player's
> ranking points, second player's ranking points, the pair's total points, and the club. Column
> headers may be in Portuguese (for example `Jogador 1`, `Jogador 2`, `PTS J1`, `PTS J2`,
> `Pontos Total`, `Clube`) or absent entirely. Ignore any header row, any totals row, and any
> decoration such as row colouring or borders.
>
> Return one object per data row, in the order the rows appear in the image, top to bottom.
>
> Rules you must follow exactly:
>
> 1. Report every value **as it appears in the image**. Do not correct, translate, reformat, or
>    capitalise names. Keep accents and punctuation exactly as shown.
> 2. If a value is missing, cut off, or you cannot read it with confidence, return `null` for that
>    field. Never guess a name and never guess a number.
> 3. Never compute a value. In particular, if the total points column is unreadable, return `null`
>    for it — do not add the two player point values together. If the total that is shown does not
>    equal the sum of the two player values, report the total that is shown.
> 4. Do not reorder, merge, split, or drop rows. If a row is entirely unreadable, still return it,
>    with `null` in every field.
> 5. Do not invent rows to make the count even.
> 6. If the image contains no lineup table at all, return an empty list.
>
> Return only data matching the schema. No commentary.

## Response schema

Handed to the provider as a structured-output schema, and re-validated on arrival by the adapter
before it becomes `RawExtractedRow[]`. Output that fails this validation is `EXTRACTION_FAILED` — it
is never partially salvaged.

```jsonc
{
  "type": "object",
  "required": ["rows"],
  "properties": {
    "rows": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "player1Name", "player2Name",
          "player1Points", "player2Points",
          "totalPoints", "club"
        ],
        "properties": {
          "player1Name":   { "type": ["string", "null"] },
          "player2Name":   { "type": ["string", "null"] },
          "player1Points": { "type": ["integer", "null"] },
          "player2Points": { "type": ["integer", "null"] },
          "totalPoints":   { "type": ["integer", "null"] },
          "club":          { "type": ["string", "null"] }
        }
      }
    }
  }
}
```

`sourceIndex` is **not** requested from the provider — the adapter assigns it from the array
position, so it cannot be hallucinated or duplicated.

## What is not sent

Only the image and the instruction above. No tournament name, no player list, no ranking data, no
previous lineup, no identifier of the organiser or the deployment. The ranking list in particular is
never sent as context: matching names against it is a server-side exact-match step with its own
loud-failure rule (FR-114), and offering the list to a model would invite it to snap a misread name
onto a real person — the one failure mode player identity is designed to prevent.
