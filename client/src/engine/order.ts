import type { DraftType, TradedPick } from './types';

/**
 * Which team owns each round, in order.
 *
 * Snake reverses every round. Linear never reverses. Third round reversal is
 * the fix leagues adopt when they think the turn is too strong: it runs round
 * three in the same direction as round two, which hands the back of the first
 * round a third straight pick and then snakes normally from there.
 */
export function roundOrder(type: DraftType, round: number, teams: number): number[] {
  const forward = Array.from({ length: teams }, (_, i) => i);
  const backward = [...forward].reverse();

  if (type === 'linear') return forward;
  if (type === 'snake') return round % 2 === 1 ? forward : backward;

  // third-round-reversal
  if (round === 1) return forward;
  if (round === 2) return backward;
  return round % 2 === 1 ? backward : forward;
}

/**
 * Every pick in the draft, in order, as the team index that will make it.
 *
 * A trade changes who makes a pick and never where it sits. The seat that owned
 * it by right still fixes its place in the order, which is why the swap is
 * written into the position that seat holds rather than moving anything.
 *
 * The consequence runs through the rest of the app: a team can hold two picks
 * in a round, or none at all, and nothing may assume one each.
 */
export function pickOrder(
  type: DraftType,
  teams: number,
  rounds: number,
  traded: TradedPick[] | null = null,
): number[] {
  const out: number[] = [];
  for (let r = 1; r <= rounds; r += 1) out.push(...roundOrder(type, r, teams));

  for (const trade of traded || []) {
    if (trade.round < 1 || trade.round > rounds) continue;
    if (trade.fromSlot < 1 || trade.fromSlot > teams) continue;
    if (trade.toSlot < 1 || trade.toSlot > teams) continue;
    // Where the original seat sits in that round. Read from the untraded order
    // on purpose: a seat holds its own place whoever ends up picking there.
    const place = roundOrder(type, trade.round, teams).indexOf(trade.fromSlot - 1);
    if (place < 0) continue;
    out[(trade.round - 1) * teams + place] = trade.toSlot - 1;
  }

  return out;
}

/**
 * Which seat a pick belongs to by right, whoever ends up making it.
 *
 * This is what fixes the column a pick sits in on the board. It answers a
 * different question from `pickOrder`, and in a league with trades the two
 * disagree, which is the entire point of showing both.
 */
export function seatOf(type: DraftType, teams: number, overall: number): number {
  const { round, slotInRound } = locate(overall, teams);
  return roundOrder(type, round, teams)[slotInRound - 1];
}

/**
 * Every pick a team holds in one round, after trades, earliest first.
 *
 * A round is no longer one pick each. Trade for a rival's third and you own two
 * of them; trade yours away and you own none, and a keeper cannot be charged to
 * a round you have nothing left in.
 */
export function picksInRound(
  type: DraftType,
  teams: number,
  round: number,
  teamIndex: number,
  traded: TradedPick[] | null = null,
): number[] {
  const order = pickOrder(type, teams, round, traded);
  const out: number[] = [];
  for (let i = (round - 1) * teams; i < round * teams; i += 1) {
    if (order[i] === teamIndex) out.push(i + 1);
  }
  return out;
}

/**
 * The picks a keeper can be charged to in a round, the right one first.
 *
 * A keeper costs "a round eight pick", and the one that phrase means is the
 * pick your own seat owns. Ordering these by pick number instead charged a
 * keeper to the earliest pick its team happened to hold, so a team holding
 * three round eights spent the one it had bought from somebody else and left
 * its own standing. On the board that read as the keeper being kept in another
 * manager's slot.
 *
 * A pick bought from somebody else is still spendable, and is what a team falls
 * back on when it traded its own away.
 */
export function keeperPicksIn(
  type: DraftType,
  teams: number,
  round: number,
  teamIndex: number,
  traded: TradedPick[] | null = null,
): number[] {
  const held = picksInRound(type, teams, round, teamIndex, traded);
  const own = held.filter((at) => seatOf(type, teams, at) === teamIndex);
  return [...own, ...held.filter((at) => !own.includes(at))];
}

/** Turn an overall pick number into the round and the slot inside it. */
export function locate(overall: number, teams: number) {
  const round = Math.floor((overall - 1) / teams) + 1;
  const slotInRound = ((overall - 1) % teams) + 1;
  return { round, slotInRound };
}

/** The overall pick numbers one team owns, in order, after trades. */
export function picksForTeam(
  type: DraftType,
  teams: number,
  rounds: number,
  teamIndex: number,
  traded: TradedPick[] | null = null,
): number[] {
  const order = pickOrder(type, teams, rounds, traded);
  const out: number[] = [];
  order.forEach((t, i) => { if (t === teamIndex) out.push(i + 1); });
  return out;
}
