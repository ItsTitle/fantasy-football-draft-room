import { bestLineup } from './roster';
import type { DraftEngine, TeamState } from './draft';
import { playersOf } from './draft';
import type { Player, Position } from './types';
import { POSITIONS } from './types';

/**
 * TWO NUMBERS, NOT ONE
 *
 * A draft grade that reads only value against ADP rewards you for reaching
 * nowhere and tells you nothing about the team you built. A grade that reads
 * only projected points rewards you for a strategy the room never punished.
 * Both are shown, side by side, and neither is folded into the other.
 *
 *   Starting points  the projected points of the best lineup this roster can
 *                    field. This is the team you take into the season.
 *   Value            picks gained against ADP. Positive means the room let
 *                    players fall to you.
 *
 * The letter comes from starting points, because that is the one that decides
 * games. The value column stands on its own.
 */

export interface TeamResult {
  team: TeamState;
  players: Player[];
  starters: Player[];
  bench: Player[];
  points: number;
  value: number;
  positionCounts: Record<Position, number>;
  byeClashes: number;
  rank: number;
  grade: string;
  bestValuePick: { player: Player; gain: number } | null;
  worstReach: { player: Player; gain: number } | null;
}

const LETTERS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-'];

/** A letter from where a team finishes in the room, not from an absolute score. */
function letterFor(rank: number, teams: number): string {
  if (teams <= 1) return 'A';
  const share = (rank - 1) / (teams - 1);
  const i = Math.min(LETTERS.length - 1, Math.round(share * (LETTERS.length - 1)));
  return LETTERS[i];
}

/**
 * How many starting slots this roster fills with players who share a bye week.
 * One shared bye between two starters counts as one clash.
 */
function countByeClashes(starters: Player[]): number {
  const weeks = new Map<number, number>();
  for (const p of starters) {
    if (!p.bye) continue;
    weeks.set(p.bye, (weeks.get(p.bye) || 0) + 1);
  }
  let clashes = 0;
  for (const n of weeks.values()) if (n > 1) clashes += n - 1;
  return clashes;
}

export function gradeDraft(engine: DraftEngine): TeamResult[] {
  const { state } = engine;
  const pickByPlayer = new Map(state.picks.map((p) => [p.playerId, p.overall]));

  const rows = state.teams.map((team) => {
    const players = playersOf(engine, team);
    const { starters, bench, points } = bestLineup(players, state.league.roster);

    let value = 0;
    let bestValuePick: TeamResult['bestValuePick'] = null;
    let worstReach: TeamResult['worstReach'] = null;

    /*
     * WHICH WAY VALUE RUNS
     *
     * You beat ADP by taking a player later than the market does, not earlier.
     * Ja'Marr Chase at pick 30 on an ADP of 2 is a steal of 28 picks; a kicker
     * at pick 5 on an ADP of 200 is the worst reach in the draft.
     *
     * This was subtracted the other way round, which scored that kicker as the
     * best value pick of the draft at +195 and made reaching on everybody the
     * winning strategy in the value column.
     */
    for (const p of players) {
      const at = pickByPlayer.get(p.id);
      if (at == null) continue;
      const gain = at - p.adp;
      value += gain;
      if (!bestValuePick || gain > bestValuePick.gain) bestValuePick = { player: p, gain };
      if (!worstReach || gain < worstReach.gain) worstReach = { player: p, gain };
    }

    const positionCounts = POSITIONS.reduce((acc, pos) => {
      acc[pos] = players.filter((p) => p.position === pos).length;
      return acc;
    }, {} as Record<Position, number>);

    return {
      team,
      players,
      starters,
      bench,
      points: Math.round(points * 10) / 10,
      value: Math.round(value * 10) / 10,
      positionCounts,
      byeClashes: countByeClashes(starters),
      rank: 0,
      grade: '',
      bestValuePick,
      worstReach,
    } as TeamResult;
  });

  const ordered = [...rows].sort((a, b) => b.points - a.points);
  ordered.forEach((row, i) => {
    row.rank = i + 1;
    row.grade = letterFor(row.rank, rows.length);
  });

  return rows;
}

/** The picks of the whole draft that beat their ADP by the most. */
export function biggestSteals(engine: DraftEngine, limit = 8) {
  return engine.state.picks
    .map((pick) => {
      const player = engine.byId.get(pick.playerId);
      // Picks later than the ADP. A player who lasted, not a player reached for.
      return player ? { pick, player, gain: pick.overall - player.adp } : null;
    })
    .filter((x): x is { pick: typeof engine.state.picks[0]; player: Player; gain: number } => !!x)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, limit);
}
