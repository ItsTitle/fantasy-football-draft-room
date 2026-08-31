import { chooseCpuPick } from './cpu';
import { locate, pickOrder, picksForTeam } from './order';
import { emptyCounts } from './roster';
import { mulberry32 } from './random';
import type {
  CpuConfig, DraftPick, LeagueConfig, Player, Position, PresetPick, PresetSource, RankingEntry,
} from './types';

export interface TeamState {
  index: number;
  name: string;
  isUser: boolean;
  playerIds: string[];
  counts: Record<Position, number>;
}

export interface DraftState {
  league: LeagueConfig;
  cpu: CpuConfig;
  order: number[];
  teams: TeamState[];
  picks: DraftPick[];
  availableIds: string[];
  /** How many random draws have been spent. Replays the draft exactly. */
  rngCalls: number;
  done: boolean;
}

export interface DraftEngine {
  state: DraftState;
  byId: Map<string, Player>;
  rankOverride: Map<string, number> | null;
  /**
   * Picks that were settled before the draft ran, by overall pick number.
   *
   * Keepers, a Sleeper draft being followed live, and catching up to a draft
   * already under way all land here. To the engine they are the same claim:
   * somebody else owns this slot, so nobody simulates it.
   */
  presets: Map<number, PresetPick>;
}

/**
 * What to call a seat.
 *
 * A real league supplies the names, and yours is shown by its real name too:
 * the board already marks your column in gold, so "You" would replace
 * information with something the colour already says.
 */
function teamName(i: number, mySlot: number, names: string[] | null): string {
  const real = names?.[i];
  if (real) return real;
  return i + 1 === mySlot ? 'You' : 'Team ' + (i + 1);
}

export function createDraft(
  league: LeagueConfig,
  cpu: CpuConfig,
  players: Player[],
  rankings: RankingEntry[] | null,
  presetPicks: PresetPick[] = [],
): DraftEngine {
  const byId = new Map(players.map((p) => [p.id, p]));
  const order = pickOrder(league.draftType, league.teams, league.rounds, league.tradedPicks);

  const teams: TeamState[] = Array.from({ length: league.teams }, (_, i) => ({
    index: i,
    name: teamName(i, league.mySlot, league.teamNames),
    isUser: i + 1 === league.mySlot,
    playerIds: [],
    counts: emptyCounts(),
  }));

  // A preset for a pick outside this draft, or naming a player the board does
  // not hold, is dropped rather than half applied.
  const presets = new Map<number, PresetPick>();
  for (const preset of presetPicks) {
    if (preset.overall < 1 || preset.overall > order.length) continue;
    if (!byId.has(preset.playerId)) continue;
    presets.set(preset.overall, preset);
  }

  // A promised player is off the board from the first pick, not from the pick
  // that claims him. Leave him in and a computer team takes your keeper in
  // round two, and by the time his own slot arrives he is already gone.
  const promised = new Set([...presets.values()].map((p) => p.playerId));

  // Sort the pool once. Every later read of "best available" is a filter of
  // this list, so the board order never has to be recomputed.
  const availableIds = [...players]
    .filter((p) => !promised.has(p.id))
    .sort((a, b) => a.adp - b.adp)
    .map((p) => p.id);

  const rankOverride = rankings && rankings.length
    ? new Map(rankings.map((r) => [r.id, r.rank]))
    : null;

  // A promised player is on the roster from the first pick, not from the pick
  // that claims him. A team keeping a receiver in round eight holds that
  // receiver in round one, and a room that does not know it drafts the same
  // position again and again until its own keeper finally lands.
  //
  // He counts against that team's remaining picks too. Sixteen rounds with one
  // keeper is fifteen picks to make, and the roster need dial reads that
  // number to decide when to stop taking depth.
  for (const [overall, preset] of presets) {
    const player = byId.get(preset.playerId);
    if (!player) continue;
    const team = teams[order[overall - 1]];
    team.playerIds.push(preset.playerId);
    team.counts[player.position] += 1;
  }

  return {
    byId,
    rankOverride,
    presets,
    state: {
      league, cpu, order, teams, picks: [], availableIds, rngCalls: 0, done: false,
    },
  };
}

/**
 * The player already promised to the pick on the clock, if there is one.
 *
 * A promised player is not in the available pool, so availability cannot be the
 * test. What matters is that nobody has taken the slot yet.
 */
export function presetFor(engine: DraftEngine, overall: number): Player | null {
  const preset = engine.presets.get(overall);
  if (!preset) return null;
  const player = engine.byId.get(preset.playerId);
  if (!player) return null;
  if (engine.state.picks.some((p) => p.playerId === player.id)) return null;
  return player;
}

/** The overall number of the pick about to happen. 1 based. */
export function currentPick(state: DraftState): number {
  return state.picks.length + 1;
}

/** Which team owns the pick about to happen, or null when the draft is over. */
export function currentTeam(state: DraftState): TeamState | null {
  const overall = currentPick(state);
  if (overall > state.order.length) return null;
  return state.teams[state.order[overall - 1]];
}

/** The overall number of your next pick, or null when you have none left. */
export function nextUserPick(state: DraftState, after?: number): number | null {
  const from = after ?? currentPick(state);
  const mine = picksForTeam(
    state.league.draftType, state.league.teams, state.league.rounds, state.league.mySlot - 1,
    state.league.tradedPicks,
  );
  return mine.find((p) => p >= from) ?? null;
}

/** How many picks happen before your next turn. */
export function picksUntilUserTurn(state: DraftState): number | null {
  const next = nextUserPick(state);
  return next == null ? null : next - currentPick(state);
}

export function availablePlayers(engine: DraftEngine): Player[] {
  return engine.state.availableIds
    .map((id) => engine.byId.get(id))
    .filter((p): p is Player => !!p);
}

function applyPick(
  engine: DraftEngine,
  player: Player,
  auto: boolean,
  preset: PresetSource | null = null,
): DraftEngine {
  const { state } = engine;
  const overall = currentPick(state);
  const teamIndex = state.order[overall - 1];
  const { round, slotInRound } = locate(overall, state.league.teams);

  // A settled pick joined its roster when the draft was built, so recording it
  // again here would hold the same player twice.
  const teams = preset
    ? state.teams
    : state.teams.map((t) => (t.index === teamIndex
      ? {
        ...t,
        playerIds: [...t.playerIds, player.id],
        counts: { ...t.counts, [player.position]: t.counts[player.position] + 1 },
      }
      : t));

  const picks: DraftPick[] = [
    ...state.picks,
    {
      overall, round, slotInRound, teamIndex, playerId: player.id, auto, preset,
    },
  ];

  return {
    ...engine,
    state: {
      ...state,
      teams,
      picks,
      availableIds: state.availableIds.filter((id) => id !== player.id),
      done: picks.length >= state.order.length,
    },
  };
}

/** Record the pick a human made. A settled pick cannot be overruled. */
export function draftPlayer(engine: DraftEngine, playerId: string): DraftEngine {
  const player = engine.byId.get(playerId);
  if (!player || engine.state.done) return engine;
  if (!engine.state.availableIds.includes(playerId)) return engine;
  if (presetFor(engine, currentPick(engine.state))) return engine;
  return applyPick(engine, player, false);
}

/** Run the pick the computer team on the clock would make. */
export function runCpuPick(engine: DraftEngine): DraftEngine {
  const { state } = engine;
  if (state.done) return engine;
  const team = currentTeam(state);
  if (!team) return engine;

  // A settled pick is taken as it stands, whoever owns the slot.
  const overall = currentPick(state);
  const promised = presetFor(engine, overall);
  if (promised) return applyPick(engine, promised, true, engine.presets.get(overall)!.source);

  // The seed plus the pick number gives every pick its own stream, so undoing a
  // pick and running it again reproduces it exactly.
  const rng = mulberry32(state.league.seed + currentPick(state) * 7919);

  const player = chooseCpuPick(availablePlayers(engine), {
    league: state.league,
    cpu: state.cpu,
    overallPick: currentPick(state),
    team: { index: team.index, counts: team.counts, picksMade: team.playerIds.length },
    rankOverride: state.cpu.cpuUsesMyRankings ? engine.rankOverride : null,
    rng,
  });

  if (!player) return { ...engine, state: { ...state, done: true } };
  return applyPick(engine, player, true);
}

/** Run computer picks until it is your turn, or the draft ends. */
export function runToUserTurn(engine: DraftEngine): DraftEngine {
  let next = engine;
  let guard = 0;
  while (!next.state.done && guard < 10000) {
    const team = currentTeam(next.state);
    if (!team) break;
    // Your own keepers fill themselves. Only stop when a real choice is yours.
    if (team.isUser && !presetFor(next, currentPick(next.state))) break;
    next = runCpuPick(next);
    guard += 1;
  }
  return next;
}

/**
 * Apply only the picks that are already settled, then stop.
 *
 * This is the whole engine loop in draft assistant mode. A real draft advances
 * when a real person picks, so nothing is simulated: the board fills to the
 * last pick Sleeper has seen and waits there.
 */
export function runPresetsOnly(engine: DraftEngine): DraftEngine {
  let next = engine;
  let guard = 0;
  while (!next.state.done && guard < 10000) {
    if (!presetFor(next, currentPick(next.state))) break;
    next = runCpuPick(next);
    guard += 1;
  }
  return next;
}

/** Run every remaining pick, including yours, from the board. */
export function autoDraftRest(engine: DraftEngine): DraftEngine {
  let next = engine;
  let guard = 0;
  while (!next.state.done && guard < 10000) {
    next = runCpuPick(next);
    guard += 1;
  }
  return next;
}

/** Take back the last pick. */
export function undoPick(engine: DraftEngine): DraftEngine {
  const { state } = engine;
  if (!state.picks.length) return engine;

  const last = state.picks[state.picks.length - 1];
  const player = engine.byId.get(last.playerId);
  if (!player) return engine;

  // Taking back a settled pick does not take the player off the roster. He was
  // never drafted there; he was kept, and he is kept again when the pick comes
  // round.
  const teams = last.preset
    ? state.teams
    : state.teams.map((t) => (t.index === last.teamIndex
      ? {
        ...t,
        playerIds: t.playerIds.filter((id) => id !== last.playerId),
        counts: { ...t.counts, [player.position]: Math.max(0, t.counts[player.position] - 1) },
      }
      : t));

  // A kept player goes back to being promised, not back on the board.
  const availableIds = last.preset
    ? state.availableIds
    : [...state.availableIds, last.playerId]
      .sort((a, b) => (engine.byId.get(a)?.adp ?? 0) - (engine.byId.get(b)?.adp ?? 0));

  return {
    ...engine,
    state: {
      ...state, teams, availableIds, picks: state.picks.slice(0, -1), done: false,
    },
  };
}

/**
 * Take back every pick up to and including your last chosen one.
 *
 * A keeper of yours is not a choice, so it is stepped over. Stopping on one
 * would undo it, refill it and look like nothing happened.
 */
export function undoToMyLastPick(engine: DraftEngine): DraftEngine {
  let next = engine;
  const mine = next.state.teams.findIndex((t) => t.isUser);
  let guard = 0;
  while (next.state.picks.length && guard < 10000) {
    const last = next.state.picks[next.state.picks.length - 1];
    next = undoPick(next);
    guard += 1;
    if (last.teamIndex === mine && !last.preset) break;
  }
  return next;
}

/**
 * The next pick you actually choose, skipping any that are already settled.
 *
 * A keeper of yours is a pick you own and not a pick you make. Counting it as
 * your next turn stops the draft dead on a slot with nothing to decide, and
 * measures the odds of a player lasting to a pick you will never use.
 */
export function nextUserChoice(engine: DraftEngine, from?: number): number | null {
  const { state } = engine;
  const start = from ?? currentPick(state);
  for (let overall = start; overall <= state.order.length; overall += 1) {
    const team = state.teams[state.order[overall - 1]];
    if (team.isUser && !engine.presets.has(overall)) return overall;
  }
  return null;
}

/** Is there any pick left that you actually choose? */
export function hasChoicesLeft(engine: DraftEngine): boolean {
  return nextUserChoice(engine) != null;
}

export function playersOf(engine: DraftEngine, team: TeamState): Player[] {
  return team.playerIds
    .map((id) => engine.byId.get(id))
    .filter((p): p is Player => !!p);
}
