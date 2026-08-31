import type { Position, RosterSlots } from './types';
import { POSITIONS } from './types';

export const FLEX_POSITIONS: Position[] = ['RB', 'WR', 'TE'];
export const SUPERFLEX_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];

export const DEFAULT_ROSTER: RosterSlots = {
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, K: 1, DEF: 1, BENCH: 6,
};

export const STARTER_SLOTS: (keyof RosterSlots)[] = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DEF'];

export function rosterSize(roster: RosterSlots): number {
  return STARTER_SLOTS.reduce((n, k) => n + roster[k], 0) + roster.BENCH;
}

export function starterCount(roster: RosterSlots): number {
  return STARTER_SLOTS.reduce((n, k) => n + roster[k], 0);
}

export function emptyCounts(): Record<Position, number> {
  return { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
}

/**
 * How many starting slots this set of players actually fills.
 *
 * Positions claim their own slots first, then what is left over falls to FLEX,
 * then to SUPERFLEX. A team holding three quarterbacks in a one quarterback
 * league fills one slot, not three, and this is what tells the computer teams
 * that the second and third one are worth much less than the first.
 */
export function startersFilled(counts: Record<Position, number>, roster: RosterSlots): number {
  let filled = 0;
  const spare = { ...counts };

  for (const pos of POSITIONS) {
    const used = Math.min(spare[pos], roster[pos]);
    filled += used;
    spare[pos] -= used;
  }

  let flexPool = FLEX_POSITIONS.reduce((n, p) => n + spare[p], 0);
  const flexUsed = Math.min(flexPool, roster.FLEX);
  filled += flexUsed;
  // Spend the flex slots off the deepest positions first so the superflex
  // count below stays honest.
  let toSpend = flexUsed;
  for (const p of FLEX_POSITIONS) {
    const take = Math.min(spare[p], toSpend);
    spare[p] -= take;
    toSpend -= take;
  }

  const sfPool = SUPERFLEX_POSITIONS.reduce((n, p) => n + spare[p], 0);
  filled += Math.min(sfPool, roster.SUPERFLEX);

  return filled;
}

/** Does adding one player at this position fill a starting slot that is open? */
export function fillsStarter(
  counts: Record<Position, number>,
  roster: RosterSlots,
  pos: Position,
): boolean {
  const before = startersFilled(counts, roster);
  const after = startersFilled({ ...counts, [pos]: counts[pos] + 1 }, roster);
  return after > before;
}

/**
 * The most of one position any team will ever hold.
 *
 * Nobody drafts a third kicker. This is the rule that stops it, and it is a
 * hard stop rather than a penalty because no dial setting should produce it.
 *
 * A league with no kicker slot gets a cap of zero, not one. Kickers and
 * defences are the two positions nobody carries as depth, so a league that does
 * not start one does not draft one at all. Every other position can sit on a
 * bench, so every other cap stays generous.
 */
export function positionCap(roster: RosterSlots, pos: Position): number {
  switch (pos) {
    case 'K': return roster.K;
    case 'DEF': return roster.DEF;
    case 'QB': return roster.QB + roster.SUPERFLEX + (roster.SUPERFLEX > 0 ? 2 : 1);
    case 'TE': return roster.TE + roster.FLEX + roster.SUPERFLEX + 2;
    default: return 99;
  }
}

/**
 * Fill the best starting lineup out of a squad, by projected points.
 *
 * Greedy by position and then by flex, which is exact here because a flex slot
 * accepts any of the positions that feed it.
 */
export function bestLineup(players: (import('./types').Player)[], roster: RosterSlots) {
  const byPos = new Map<Position, import('./types').Player[]>();
  for (const p of players) {
    const list = byPos.get(p.position) || [];
    list.push(p);
    byPos.set(p.position, list);
  }
  for (const list of byPos.values()) list.sort((a, b) => (b.points ?? 0) - (a.points ?? 0));

  const starters: import('./types').Player[] = [];
  const taken = new Set<string>();

  for (const pos of POSITIONS) {
    const list = byPos.get(pos) || [];
    for (let i = 0; i < roster[pos] && i < list.length; i += 1) {
      starters.push(list[i]);
      taken.add(list[i].id);
    }
  }

  const claim = (allowed: Position[], slots: number) => {
    const pool = allowed
      .flatMap((pos) => byPos.get(pos) || [])
      .filter((p) => !taken.has(p.id))
      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    for (let i = 0; i < slots && i < pool.length; i += 1) {
      starters.push(pool[i]);
      taken.add(pool[i].id);
    }
  };

  claim(FLEX_POSITIONS, roster.FLEX);
  claim(SUPERFLEX_POSITIONS, roster.SUPERFLEX);

  const points = starters.reduce((n, p) => n + (p.points ?? 0), 0);
  const bench = players.filter((p) => !taken.has(p.id));
  return { starters, bench, points };
}
