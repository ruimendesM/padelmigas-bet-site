import type { ExternalPlayerId } from '@padelmigas/contracts';
import type { Player } from '../domain/index.js';

/**
 * Player identity resolution (FR-004, ADR-007).
 *
 * The canonical identity is the **normalised name** (`matchKey`). A lineup carries names, so a name
 * has to be turned into an identity — and the rule the spec fixes is that this is done by
 * **normalised exact matching, never fuzzy matching**, and that a miss is reported for a human to
 * fix rather than resolved by a guess.
 *
 * The empirical basis (research F2, re-measured 2026-08-28): 784 ranking rows with 0 duplicate
 * names, and 24 of 24 lineup names matching after case folding — the one mismatch was the
 * capitalisation of a name particle. Because uniqueness is a property of today's data and not a
 * guarantee, this module re-checks for colliding match keys on every call and refuses to resolve
 * anything when it finds one.
 *
 * **Amended 2026-08-28 (FR-004, ADR-007 § Amendment)**: identity was previously the sheet's `ID`,
 * and a payload could carry an explicit `externalId` to disambiguate two people sharing a name. That
 * escape hatch is gone, because the sheet reuses ids across different people — 784 rows carry only
 * 756 distinct ids — so an explicit id could select the wrong person outright. The consequence is
 * accepted and recorded: two genuinely identical normalised names now abort the import with no
 * payload-level override. The mitigation, when it first bites, is ADR-007's deferred admin merge UI.
 */

/**
 * Normalises a name into a match key.
 *
 * NFC → case fold → collapse whitespace, in that order, and nothing else. In particular accents are
 * **preserved**: stripping them would let two genuinely different names collide, which is worse than
 * a loud miss an organiser can fix in ten seconds.
 *
 * Kept in this package rather than in SQL so that the web app today and any future host normalise
 * identically — the same reason `players.match_key` is written by this function and never derived by
 * a database expression (data-model.md).
 */
export function toMatchKey(name: string): string {
  return (
    name
      .normalize('NFC')
      // `toLowerCase` after NFC: composing first means "ç" is one code point when folded, so the
      // result is stable regardless of how the source encoded the accent.
      .toLowerCase()
      // \s misses U+00A0 (non-breaking space), which spreadsheet exports and pasted documents both
      // produce. Matching the Unicode space property catches those too.
      .replace(/[\s\u00a0\p{Zs}]+/gu, ' ')
      .trim()
  );
}

/** A name as it appears in a lineup payload. */
export interface NameToResolve {
  readonly name: string;
  readonly points: number;
}

export interface ResolvedPlayer {
  readonly inputName: string;
  readonly playerId: Player['id'];
  /** Informational only; NOT unique (FR-004 as amended 2026-08-28). */
  readonly externalId: ExternalPlayerId | null;
  readonly displayName: string;
  /**
   * True when the ranking-list player had no local record yet.
   *
   * Always `false` today: resolution matches against players already imported by the ranking sync,
   * so an unimported person is a miss, not a new identity. The field exists because the preview
   * contract promises it and because a future import-on-publish path would set it.
   */
  readonly isNew: boolean;
}

export interface UnresolvedName {
  /** Index into the input array, so the caller can build a payload path like `pairs[3].players[1]`. */
  readonly index: number;
  readonly name: string;
}

/** Two known players normalising to the same key — an import-blocking condition (ADR-007). */
export interface AmbiguousMatchKey {
  readonly matchKey: string;
  /** Printed to help an organiser find the offending rows; ids do not identify anyone. */
  readonly externalIds: readonly (ExternalPlayerId | null)[];
}

export interface ResolutionResult {
  readonly resolved: readonly ResolvedPlayer[];
  readonly unresolved: readonly UnresolvedName[];
  readonly ambiguous: readonly AmbiguousMatchKey[];
}

/**
 * Resolves lineup names against known players.
 *
 * Reports every problem rather than the first (FR-005): an organiser fixing a pasted lineup should
 * see all six typos at once, not discover them one submission at a time.
 *
 * When any match key is ambiguous the whole resolution is abandoned — `resolved` comes back empty
 * even for names that would have matched cleanly. That is deliberate: a duplicate name means the
 * *identity model* is broken, and resolving the neighbours would produce a tournament that looks
 * fine and attributes one pair to the wrong person.
 */
export function resolvePlayers(
  names: readonly NameToResolve[],
  knownPlayers: readonly Player[],
): ResolutionResult {
  const byMatchKey = new Map<string, Player[]>();

  for (const player of knownPlayers) {
    const bucket = byMatchKey.get(player.matchKey);
    if (bucket) bucket.push(player);
    else byMatchKey.set(player.matchKey, [player]);
  }

  const ambiguous: AmbiguousMatchKey[] = [];
  for (const [matchKey, players] of byMatchKey) {
    if (players.length > 1) {
      ambiguous.push({ matchKey, externalIds: players.map((p) => p.externalId) });
    }
  }

  if (ambiguous.length > 0) {
    // Nothing is resolved while the identity model is broken. See the note above.
    return { resolved: [], unresolved: [], ambiguous };
  }

  const resolved: ResolvedPlayer[] = [];
  const unresolved: UnresolvedName[] = [];

  names.forEach((entry, index) => {
    const matchKey = toMatchKey(entry.name);
    // An empty key means the input was whitespace; there is nothing to match against.
    const candidates = matchKey.length === 0 ? undefined : byMatchKey.get(matchKey);
    const match = candidates?.[0];

    if (match) {
      resolved.push({
        inputName: entry.name,
        playerId: match.id,
        externalId: match.externalId,
        displayName: match.displayName,
        isNew: false,
      });
    } else {
      unresolved.push({ index, name: entry.name });
    }
  });

  return { resolved, unresolved, ambiguous };
}
