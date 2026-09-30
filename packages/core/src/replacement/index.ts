import type { GroupId, PairId, PlayerId } from '@padelmigas/contracts/common';

/**
 * Replacing an open tournament with a corrected lineup (feature 003).
 *
 * Two decisions live here, both pure:
 *
 *  - **Which groups keep their votes** (FR-206). A replacement group is unchanged when the original
 *    has a group with the same label whose set of pairs is identical, a pair being its two players
 *    regardless of order. Points, seeds and club are ignored — a refreshed ranking must not throw
 *    away votes on a group whose pairs are exactly who they were.
 *  - **Where the original moves to** (FR-210). The replacement takes over the original's slug; the
 *    original gets a derived one that stays unique across repeated replacements.
 *
 * The repository executes the plan; it never re-derives it, so there is one place the rule lives.
 */

interface MemberRef {
  readonly playerId: PlayerId;
}

export interface CarryOverSourceGroup {
  readonly id: GroupId;
  readonly label: string;
  readonly pairs: readonly {
    readonly id: PairId;
    readonly members: readonly [MemberRef, MemberRef];
  }[];
}

export interface CarryOverTargetGroup {
  readonly label: string;
  readonly pairs: readonly {
    /** Identifies the pair within its group; replacement pair ids exist only after insert. */
    readonly seed: number;
    readonly members: readonly [MemberRef, MemberRef];
  }[];
}

export interface CarriedGroup {
  readonly groupId: GroupId;
  /** One entry per pair: every ballot entry on `fromPairId` moves to the pair at `toSeed`. */
  readonly pairMap: readonly { readonly fromPairId: PairId; readonly toSeed: number }[];
}

export interface CarryOverDecision {
  readonly label: string;
  /** `null` means voting restarts on this group (FR-209). */
  readonly carriedFrom: CarriedGroup | null;
}

/** A pair's identity: its two players, order-free. */
function pairKey(members: readonly [MemberRef, MemberRef]): string {
  return [members[0].playerId, members[1].playerId].sort().join('|');
}

export function planCarryOver(
  original: readonly CarryOverSourceGroup[],
  replacement: readonly CarryOverTargetGroup[],
): CarryOverDecision[] {
  const originalByLabel = new Map(original.map((group) => [group.label, group]));

  return replacement.map((group) => {
    const from = originalByLabel.get(group.label);
    if (!from || from.pairs.length !== group.pairs.length) {
      return { label: group.label, carriedFrom: null };
    }

    // A player appears at most once per tournament (FR-005), so keys are unique within a group and
    // equal sizes plus every key found means the two sets are equal.
    const fromByKey = new Map(from.pairs.map((pair) => [pairKey(pair.members), pair.id]));
    const pairMap: { fromPairId: PairId; toSeed: number }[] = [];
    for (const pair of group.pairs) {
      const fromPairId = fromByKey.get(pairKey(pair.members));
      if (fromPairId === undefined) return { label: group.label, carriedFrom: null };
      pairMap.push({ fromPairId, toSeed: pair.seed });
    }

    return { label: group.label, carriedFrom: { groupId: from.id, pairMap } };
  });
}

export const INVALIDATED_SLUG_INFIX = '-invalidado-';

/** Matches the database CHECK and the contract's `slug` schema. */
const MAX_SLUG_LENGTH = 120;

/**
 * The slug an invalidated tournament moves to: `<slug>-invalidado-<n>`, `n` one past the highest
 * already taken for this base, so repeated replacements never collide (FR-210, research R5).
 *
 * `taken` is every existing slug beginning with the base and the infix; anything whose tail is not a
 * number belongs to some other tournament and is ignored.
 */
export function invalidatedSlug(slug: string, taken: readonly string[]): string {
  const prefix = `${slug}${INVALIDATED_SLUG_INFIX}`;
  const highest = taken.reduce((max, candidate) => {
    const tail = candidate.startsWith(prefix) ? candidate.slice(prefix.length) : '';
    return /^\d+$/.test(tail) ? Math.max(max, Number(tail)) : max;
  }, 0);

  const suffix = `${INVALIDATED_SLUG_INFIX}${highest + 1}`;
  // Truncating may cut just after a hyphen; strip it so the result never holds `--`.
  const base = slug.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '');
  return `${base}${suffix}`;
}
