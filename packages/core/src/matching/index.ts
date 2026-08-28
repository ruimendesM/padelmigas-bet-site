import type { ExternalPlayerId } from '@padelmigas/contracts';
import type { Player } from '../domain/index.js';

/**
 * Player identity resolution (FR-004, ADR-007).
 *
 * The canonical identity is the ranking sheet's `ID`. A lineup carries names, so a name has to be
 * turned into an identity — and the rule the spec fixes is that this is done by **normalised exact
 * matching, never fuzzy matching**, and that a miss is reported for a human to fix rather than
 * resolved by a guess.
 *
 * The empirical basis (research F2): 783 ranking rows with 0 duplicate names, and 24 of 24 lineup
 * names matching after case folding — the one mismatch was the capitalisation of a name particle.
 * Because uniqueness is a property of today's data and not a guarantee, this module also re-checks
 * for colliding match keys on every call and refuses to resolve anything when it finds one.
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
  /** Ranking-list ID, supplied only to disambiguate identical names. */
  readonly externalId?: ExternalPlayerId;
}

export interface ResolvedPlayer {
  readonly inputName: string;
  readonly playerId: Player['id'];
  readonly externalId: ExternalPlayerId;
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
  /** Present when an explicit id was given and did not exist. */
  readonly externalId?: ExternalPlayerId;
}

/** Two known players normalising to the same key — an import-blocking condition (ADR-007). */
export interface AmbiguousMatchKey {
  readonly matchKey: string;
  readonly externalIds: readonly ExternalPlayerId[];
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
  const byExternalId = new Map<ExternalPlayerId, Player>();

  for (const player of knownPlayers) {
    const bucket = byMatchKey.get(player.matchKey);
    if (bucket) bucket.push(player);
    else byMatchKey.set(player.matchKey, [player]);
    byExternalId.set(player.externalId, player);
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
    if (entry.externalId !== undefined) {
      // An explicit id is an assertion by the organiser. Falling back to the name when it misses
      // would resolve a different person than the one they named.
      const byId = byExternalId.get(entry.externalId);
      if (byId) {
        resolved.push({
          inputName: entry.name,
          playerId: byId.id,
          externalId: byId.externalId,
          displayName: byId.displayName,
          isNew: false,
        });
      } else {
        unresolved.push({ index, name: entry.name, externalId: entry.externalId });
      }
      return;
    }

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
