import { gaussian } from './random';
import { fillsStarter, positionCap, starterCount, startersFilled } from './roster';
import type { CpuConfig, LeagueConfig, Player, Position, RosterSlots } from './types';
import { POSITIONS } from './types';

/**
 * HOW A COMPUTER TEAM PICKS
 *
 * Every available player gets a score in units of draft picks, and the lowest
 * score wins the pick. Starting from ADP and staying in pick units keeps every
 * dial readable: a setting that moves a player by twelve means twelve real
 * picks.
 *
 *   score = biased ADP + a random draw - the roster need bonus + a late
 *           position penalty
 *
 * Position bias moves a player by a share of their ADP plus a flat shift. The
 * share is what makes the dial behave the same at the top and the bottom of the
 * board: pushing running backs up by forty per cent moves the back at pick 60
 * to pick 33 and the back at pick 10 to pick 3. That is what "weigh running
 * backs more heavily" has to mean to stay useful in both places.
 *
 * The random draw is scaled by the standard deviation of the player's real ADP,
 * so the uncertainty sits where real drafts put it. At the default setting of 3
 * the simulator reaches exactly as far as the market does.
 */

/** How far the strongest position setting moves a player, as a share of ADP. */
const BIAS_SHARE = 0.4;
/** The flat part of the position setting, in picks. Keeps the top of the board live. */
const BIAS_FLAT = 2.5;
/** The randomness setting that reproduces real market variance. */
export const MARKET_RANDOMNESS = 3;
/**
 * The furthest ahead of ADP any team will reach, in picks, at randomness 0.
 * Every point of randomness adds to it.
 *
 * Without this floor the deepest players on the board carry a spread wide
 * enough that one draw puts a player nobody drafts into round two. Real rooms
 * reach; they do not reach eighty rounds.
 */
const REACH_BASE = 50;
const REACH_PER_POINT = 12;
/**
 * Two bounds on the random draw, both about keeping the top setting playable
 * rather than merely loud.
 *
 * The floor lets the highest settings shake the top of the board. Spread is
 * measured per player, and the market is so sure about the first few picks that
 * a purely proportional draw would leave round one untouched no matter how far
 * the dial went. The floor only opens above the market setting, so the market
 * setting still reproduces the market exactly.
 *
 * The ceiling stops a player at pick 250 landing in round three.
 */
const NOISE_FLOOR_PER_POINT = 1.2;
const NOISE_CEILING = 60;

const bias = (over: Partial<Record<Position, number>>): Record<Position, number> => ({
  QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0, ...over,
});

export function emptyBias(): Record<Position, number> {
  return bias({});
}

export const DEFAULT_CPU: CpuConfig = {
  positionBias: emptyBias(),
  randomness: MARKET_RANDOMNESS,
  needWeight: 5,
  cpuUsesMyRankings: false,
};

export interface CpuPreset {
  id: string;
  name: string;
  blurb: string;
  cpu: CpuConfig;
}

export const PRESETS: CpuPreset[] = [
  {
    id: 'market',
    name: 'Market',
    blurb: 'Drafts the board as it stands, with the variance real drafts show.',
    cpu: { ...DEFAULT_CPU },
  },
  {
    id: 'chalk',
    name: 'Chalk',
    blurb: 'Almost no reaching. Shows the earliest a player can fall to you.',
    cpu: { ...DEFAULT_CPU, randomness: 0.5, needWeight: 3 },
  },
  {
    id: 'zero-rb',
    name: 'Zero RB room',
    blurb: 'Receivers and tight ends fly, running backs slide.',
    cpu: { ...DEFAULT_CPU, positionBias: bias({ RB: -4, WR: 3, TE: 2 }) },
  },
  {
    id: 'robust-rb',
    name: 'Robust RB room',
    blurb: 'Running backs go early and often. Tests taking receivers late.',
    cpu: { ...DEFAULT_CPU, positionBias: bias({ RB: 4, WR: -1 }) },
  },
  {
    id: 'early-qb',
    name: 'Quarterback run',
    blurb: 'Quarterbacks come off the board two rounds early.',
    cpu: { ...DEFAULT_CPU, positionBias: bias({ QB: 4 }) },
  },
  {
    id: 'late-qb',
    name: 'Nobody wants a quarterback',
    blurb: 'Quarterbacks slide. Shows what waiting really buys you.',
    cpu: { ...DEFAULT_CPU, positionBias: bias({ QB: -4 }) },
  },
  {
    id: 'chaos',
    name: 'Chaos',
    blurb: 'Triple the normal reach. Every run is a different draft.',
    cpu: { ...DEFAULT_CPU, randomness: 9, needWeight: 4 },
  },
];

/** Move an ADP by one position setting, in the -5 to +5 range. */
export function applyBias(adp: number, level: number): number {
  const tilt = Math.max(-5, Math.min(5, level)) / 5;
  return adp * (1 - BIAS_SHARE * tilt) - BIAS_FLAT * tilt;
}

/** The sentence the settings panel shows under a position slider. */
export function describeBias(level: number, examplePick = 60): string {
  if (level === 0) return 'Follows ADP exactly.';
  const moved = Math.max(1, Math.round(applyBias(examplePick, level)));
  const dir = level > 0 ? 'earlier' : 'later';
  const pct = Math.abs(Math.round(((moved - examplePick) / examplePick) * 100));
  return pct + '% ' + dir + '. Pick ' + examplePick + ' becomes about pick ' + moved + '.';
}

export interface TeamView {
  index: number;
  counts: Record<Position, number>;
  picksMade: number;
}

export interface PickContext {
  league: LeagueConfig;
  cpu: CpuConfig;
  team: TeamView;
  /** The overall number of the pick being made. Bounds how far a team reaches. */
  overallPick: number;
  /** The rank to draft by, per player id. Falls back to the player's ADP. */
  rankOverride?: Map<string, number> | null;
  rng: () => number;
}

/**
 * Score every available player for one computer team and return the best.
 * Returns null only when the pool is empty.
 */
export function chooseCpuPick(available: Player[], ctx: PickContext): Player | null {
  const { league, cpu, team, rng } = ctx;
  const roster: RosterSlots = league.roster;
  const picksLeft = league.rounds - team.picksMade;
  const openStarters = Math.max(0, starterCount(roster) - startersFilled(team.counts, roster));
  const needScale = cpu.needWeight / 5;
  const noiseScale = cpu.randomness / MARKET_RANDOMNESS;
  const reachLimit = ctx.overallPick + REACH_BASE + cpu.randomness * REACH_PER_POINT;
  const noiseFloor = Math.max(0, (cpu.randomness - MARKET_RANDOMNESS) * NOISE_FLOOR_PER_POINT);

  // When a team has exactly as many picks left as it has open starting slots,
  // it stops taking depth. This is a hard rule and not a lean: a roster that
  // cannot field a lineup is not a draft result anybody wants to read.
  const mustFillStarters = needScale > 0 && picksLeft <= openStarters;

  let best: Player | null = null;
  let bestScore = Infinity;

  for (const player of available) {
    const pos = player.position;
    if (player.adp > reachLimit) break; // The pool is in board order.
    if (team.counts[pos] >= positionCap(roster, pos)) continue;

    const fills = fillsStarter(team.counts, roster, pos);
    if (mustFillStarters && !fills) continue;

    const base = ctx.rankOverride?.get(player.id) ?? player.adp;
    let score = applyBias(base, cpu.positionBias[pos] ?? 0);

    if (noiseScale > 0) {
      const spread = Math.min(
        NOISE_CEILING,
        Math.max(0.8, player.adpStdev, noiseFloor) * noiseScale,
      );
      score += gaussian(rng, 0, spread);
    }

    if (needScale > 0) {
      const urgency = picksLeft > 0 ? Math.min(1, openStarters / picksLeft) : 1;
      if (fills) score -= needScale * (10 + 28 * urgency);

      // Kickers and defences go in the last two rounds of every real draft, and
      // ADP alone does not enforce that in a short one.
      if ((pos === 'K' || pos === 'DEF') && picksLeft > 2) {
        score += needScale * 45;
      }
    }

    if (score < bestScore) {
      bestScore = score;
      best = player;
    }
  }

  // Every cap is full, or the reach limit left nothing. Take the best player on
  // the board rather than stalling the draft.
  if (!best) return available.length ? available[0] : null;
  return best;
}

export { POSITIONS };
