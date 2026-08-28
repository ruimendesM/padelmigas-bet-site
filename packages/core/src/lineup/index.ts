import type { ExternalPlayerId, PlayerId } from '@padelmigas/contracts';
import { MAX_GROUP_SIZE, MIN_GROUP_SIZE } from '@padelmigas/contracts/common';
import type { Player } from '../domain/index.js';
import { DomainError, IssueCollector } from '../errors.js';
import { resolvePlayers, type NameToResolve, type ResolvedPlayer } from '../matching/index.js';

/**
 * Turns a pasted lineup into a validated, grouped tournament (FR-003, FR-005, FR-007).
 *
 * Every rule here stops bad data reaching a public page (Risk R9), and every rule reports rather than
 * throws on first sight: an organiser fixing a paste should see all six problems at once, not
 * discover them one submission at a time (FR-005).
 *
 * Grouping follows research D10: order by pair total points descending, chunk into groups of six,
 * allow a short final group of 3–5, reject anything smaller. The payload may override grouping with
 * explicit labels, because that is how a lineup that does not divide evenly is actually organised.
 */

export interface LineupInputPlayer {
  readonly name: string;
  readonly points: number;
}

export interface LineupInputPair {
  readonly club: string;
  readonly totalPoints: number;
  /** Optional explicit group label. Either every pair names one, or none does. */
  readonly group?: string;
  readonly players: readonly [LineupInputPlayer, LineupInputPlayer];
}

export interface LineupInput {
  readonly name: string;
  readonly slug?: string;
  /** ISO instant. Must be strictly in the future; also the voting deadline (FR-005, FR-011). */
  readonly startsAt: string;
  readonly pairs: readonly LineupInputPair[];
}

export interface DerivedPairMember {
  readonly playerId: PlayerId;
  /** Informational only and NOT unique (FR-004 as amended 2026-08-28). */
  readonly externalId: ExternalPlayerId | null;
  readonly displayName: string;
  /** Captured now, at publish time, and never rewritten by a later ranking sync (FR-007). */
  readonly points: number;
}

export interface DerivedPair {
  readonly club: string;
  readonly seed: number;
  readonly totalPoints: number;
  readonly members: readonly [DerivedPairMember, DerivedPairMember];
  /** Index in the original payload, so an issue path can point back at what was pasted. */
  readonly sourceIndex: number;
}

export interface DerivedGroup {
  readonly label: string;
  readonly position: number;
  readonly pairs: readonly DerivedPair[];
}

export interface DerivedLineup {
  readonly name: string;
  readonly slug: string;
  readonly startsAt: Date;
  readonly groups: readonly DerivedGroup[];
  readonly resolvedPlayers: readonly ResolvedPlayer[];
}

/**
 * Derives a URL slug from a tournament name.
 *
 * Accents are stripped here — unlike in `toMatchKey`, where stripping them would collide two
 * different people. A slug is an address, not an identity, so `Histórico` and `Historico` sharing one
 * is a feature.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
}

/** Chunks pairs into groups of at most `MAX_GROUP_SIZE`, preserving order. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** `A`, `B`, … for derived groups. Beyond 26 groups it continues `AA` — unreachable at club scale. */
function derivedLabel(index: number): string {
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode('A'.charCodeAt(0) + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

interface IndexedPair {
  readonly pair: LineupInputPair;
  readonly sourceIndex: number;
}

export function deriveLineup(
  input: LineupInput,
  knownPlayers: readonly Player[],
  now: Date,
): DerivedLineup {
  const issues = new IssueCollector();

  // ---------------------------------------------------------------------------------------------
  // Shape decisions that make the rest meaningless if wrong — checked first, and fatal on their own.
  // ---------------------------------------------------------------------------------------------
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) {
    throw new DomainError('MALFORMED_PAYLOAD', 'A data de início não é uma data válida.', [
      { path: 'startsAt', message: `"${input.startsAt}" não é um instante ISO 8601 válido.` },
    ]);
  }

  const slug = input.slug ?? slugify(input.name);
  if (slug.length === 0) {
    throw new DomainError(
      'MALFORMED_PAYLOAD',
      'Não é possível derivar um endereço a partir deste nome.',
      [
        {
          path: 'name',
          message: `"${input.name}" não produz nenhum endereço utilizável. Indica um "slug" explícito.`,
        },
      ],
    );
  }

  const labelled = input.pairs.filter((pair) => pair.group !== undefined).length;
  if (labelled > 0 && labelled < input.pairs.length) {
    throw new DomainError(
      'MALFORMED_PAYLOAD',
      'Ou todas as duplas indicam um grupo, ou nenhuma indica.',
      [
        {
          path: 'pairs',
          message:
            `${labelled} de ${input.pairs.length} duplas indicam um grupo. Um alinhamento ` +
            'parcialmente marcado é ambíguo: indica o grupo em todas, ou em nenhuma para derivar ' +
            'a partir dos pontos.',
        },
      ],
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Rules that each report an issue and let the others run (FR-005).
  // ---------------------------------------------------------------------------------------------

  // The start instant is also the voting deadline, so publishing at or after it would publish a
  // tournament nobody can vote on (FR-005, FR-011). `<=` is deliberate: equality is already closed.
  if (startsAt.getTime() <= now.getTime()) {
    issues.add(
      'startsAt',
      `A data de início (${startsAt.toISOString()}) tem de ser no futuro. ` +
        `Agora são ${now.toISOString()}.`,
    );
  }

  input.pairs.forEach((pair, index) => {
    const sum = pair.players[0].points + pair.players[1].points;
    if (pair.totalPoints !== sum) {
      issues.add(
        `pairs[${index}].totalPoints`,
        `O total indicado (${pair.totalPoints}) não corresponde à soma dos jogadores (${sum}).`,
      );
    }
  });

  // Resolve every name in payload order, so an issue index maps straight back to what was pasted.
  const namesToResolve: NameToResolve[] = [];
  for (const pair of input.pairs) {
    for (const player of pair.players) {
      namesToResolve.push({ name: player.name, points: player.points });
    }
  }

  const resolution = resolvePlayers(namesToResolve, knownPlayers);

  if (resolution.ambiguous.length > 0) {
    // The identity model itself is broken; nothing downstream can be trusted (ADR-007).
    throw new DomainError(
      'DUPLICATE_MATCH_KEY',
      'Há jogadores no ranking com nomes que normalizam para o mesmo valor. ' +
        'Resolve manualmente antes de publicar.',
      resolution.ambiguous.map((entry) => ({
        path: 'players',
        message:
          `O nome "${entry.matchKey}" aparece em mais do que uma linha do ranking ` +
          `(IDs ${entry.externalIds.map((id) => id ?? '-').join(', ')}).`,
      })),
    );
  }

  for (const miss of resolution.unresolved) {
    const pairIndex = Math.floor(miss.index / 2);
    const slot = miss.index % 2;
    issues.add(
      `pairs[${pairIndex}].players[${slot}].name`,
      `Nenhum jogador do ranking corresponde a "${miss.name}".`,
    );
  }

  // A player in two pairs of one tournament is rejected before insert: the constraint is not
  // expressible per-tournament in SQL without a trigger, and a trigger is not warranted at this
  // scale (data-model.md).
  const seenPlayerIds = new Map<PlayerId, number>();
  resolution.resolved.forEach((resolved, flatIndex) => {
    const pairIndex = Math.floor(flatIndex / 2);
    const previous = seenPlayerIds.get(resolved.playerId);
    if (previous !== undefined) {
      issues.add(
        `pairs[${pairIndex}].players[${flatIndex % 2}].name`,
        `"${resolved.displayName}" aparece em mais do que uma dupla ` +
          `(duplas ${previous} e ${pairIndex}).`,
      );
      return;
    }
    seenPlayerIds.set(resolved.playerId, pairIndex);
  });

  // ---------------------------------------------------------------------------------------------
  // Grouping. Runs before the issue throw so a size problem is reported alongside the rest.
  // ---------------------------------------------------------------------------------------------
  const indexed: IndexedPair[] = input.pairs.map((pair, sourceIndex) => ({ pair, sourceIndex }));
  const byStrength = [...indexed].sort((a, b) => {
    if (b.pair.totalPoints !== a.pair.totalPoints) {
      return b.pair.totalPoints - a.pair.totalPoints;
    }
    // Deterministic tie-break so two equal totals never swap between previews.
    return a.sourceIndex - b.sourceIndex;
  });

  const grouped: { label: string; members: IndexedPair[] }[] =
    labelled === input.pairs.length
      ? groupByExplicitLabel(byStrength)
      : chunk(byStrength, MAX_GROUP_SIZE).map((members, index) => ({
          label: derivedLabel(index),
          members,
        }));

  for (const group of grouped) {
    if (group.members.length < MIN_GROUP_SIZE || group.members.length > MAX_GROUP_SIZE) {
      issues.add(
        'pairs',
        `O grupo "${group.label}" tem ${group.members.length} duplas. ` +
          `Um grupo tem de ter entre ${MIN_GROUP_SIZE} e ${MAX_GROUP_SIZE}.`,
      );
    }
  }

  // One error carrying every issue found. `code` names the dominant problem so a client can still
  // branch on a single value; `issues` carries the detail (contracts/README rule 5).
  if (!issues.isEmpty) {
    throw new DomainError(
      dominantCode(issues),
      'O alinhamento tem problemas a corrigir.',
      issues.all(),
    );
  }

  const resolvedByFlatIndex = resolution.resolved;
  const groups: DerivedGroup[] = grouped.map((group, position) => ({
    label: group.label,
    position: position + 1,
    pairs: group.members.map((entry, seedIndex) => {
      const firstResolved = resolvedByFlatIndex[entry.sourceIndex * 2];
      const secondResolved = resolvedByFlatIndex[entry.sourceIndex * 2 + 1];
      if (!firstResolved || !secondResolved) {
        // Unreachable: every name resolved or the throw above fired. Kept as a guard rather than a
        // non-null assertion so a future change fails loudly instead of producing a wrong pair.
        throw new DomainError(
          'INTERNAL_ERROR',
          'Falha interna ao associar jogadores às duplas depois da validação.',
        );
      }
      return {
        club: entry.pair.club,
        seed: seedIndex + 1,
        totalPoints: entry.pair.totalPoints,
        sourceIndex: entry.sourceIndex,
        members: [
          {
            playerId: firstResolved.playerId,
            externalId: firstResolved.externalId,
            displayName: firstResolved.displayName,
            points: entry.pair.players[0].points,
          },
          {
            playerId: secondResolved.playerId,
            externalId: secondResolved.externalId,
            displayName: secondResolved.displayName,
            points: entry.pair.players[1].points,
          },
        ],
      };
    }),
  }));

  return {
    name: input.name,
    slug,
    startsAt,
    groups,
    resolvedPlayers: resolution.resolved,
  };
}

/**
 * Groups by explicit label, ordering groups by their strongest pair.
 *
 * Ordering by strength rather than alphabetically means group 1 is always the top group, which is how
 * a lineup is read, regardless of what the organiser called it.
 */
function groupByExplicitLabel(
  byStrength: readonly IndexedPair[],
): { label: string; members: IndexedPair[] }[] {
  const buckets = new Map<string, IndexedPair[]>();
  for (const entry of byStrength) {
    // Guaranteed present: the caller only takes this path when every pair names a group.
    const label = entry.pair.group ?? '';
    const bucket = buckets.get(label);
    if (bucket) bucket.push(entry);
    else buckets.set(label, [entry]);
  }
  // Insertion order follows `byStrength`, so the first bucket created holds the strongest pair.
  return [...buckets.entries()].map(([label, members]) => ({ label, members }));
}

/**
 * Picks the error code that best names a mixed set of issues.
 *
 * Clients branch on `code`, so it has to be one value. The order below is by how actionable the
 * problem is: an unmatched name is the organiser's first job, a group-size problem the last.
 */
type LineupErrorCode =
  | 'UNRESOLVED_PLAYERS'
  | 'DUPLICATE_PLAYER'
  | 'POINTS_MISMATCH'
  | 'START_NOT_IN_FUTURE'
  | 'INVALID_GROUP_SIZE';

function dominantCode(issues: IssueCollector): LineupErrorCode {
  const paths = issues.all();
  const messages = paths.map((issue) => issue.message);

  if (messages.some((m) => m.startsWith('Nenhum jogador do ranking'))) return 'UNRESOLVED_PLAYERS';
  if (messages.some((m) => m.includes('aparece em mais do que uma dupla')))
    return 'DUPLICATE_PLAYER';
  if (messages.some((m) => m.includes('não corresponde à soma'))) return 'POINTS_MISMATCH';
  if (paths.some((issue) => issue.path === 'startsAt')) return 'START_NOT_IN_FUTURE';
  return 'INVALID_GROUP_SIZE';
}
