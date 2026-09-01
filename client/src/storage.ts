import { DEFAULT_MANAGER, SEED_LEAGUES as CONFIGURED_LEAGUES } from './config';
import { DEFAULT_CPU } from './engine/cpu';
import { DEFAULT_ROSTER, rosterSize } from './engine/roster';
import type {
  AppMode, CpuConfig, LeagueConfig, Overrides, RankingSet, SavedLeague,
} from './engine/types';

/**
 * Settings live in the browser. Nothing here is worth an account, and a mock
 * draft you have to set up again every time is a mock draft you run once.
 *
 * Three things in particular are kept because retyping them is the whole
 * friction: your ranking file, the name mappings you corrected by hand, and
 * the Sleeper leagues you draft in.
 */

const KEY = 'draftroom.v1';

export interface RankingSource {
  text: string;
  label: string;
  /** The column you pointed at, when detection got it wrong. */
  rankColumn: number | null;
}

export interface Saved {
  /** Whether this run simulates a room or follows a real draft. */
  mode: AppMode;
  /** Replaces league names, IDs and manager names on screen. For sharing. */
  anonymous: boolean;
  league: LeagueConfig;
  cpu: CpuConfig;
  rankings: RankingSet | null;
  /** The file itself, so a new override can be applied without re-uploading. */
  rankingSource: RankingSource | null;
  /**
   * Your notes file, kept the same way and for the same reason.
   *
   * Separate from `rankingSource` because the two have different lifetimes. A
   * ranking export is replaced every time its publisher updates; a note you
   * wrote about a player should survive that.
   */
  noteSource: RankingSource | null;
  /** Name to player mappings you made by hand. These outlive every upload. */
  overrides: Overrides;
  savedLeagues: SavedLeague[];
  activeLeagueId: string | null;
  cpuPreset: string;
  pace: number;
  /**
   * Your Sleeper name, so a league you load already knows which seat is yours.
   *
   * The seat itself cannot be saved once and reused: it is different in every
   * league, and Sleeper does not draw the order until the draft is close. The
   * name is the same everywhere, so it is the thing worth keeping. Change the
   * manager on any league and this follows it.
   */
  myManager: string | null;
  /**
   * Whether a mock picks up from where your real draft has got to.
   *
   * Off is the ordinary case: a mock runs the whole draft from pick one. On, it
   * reads what the room has actually taken and simulates only what is left,
   * which is what you want once a draft is under way and you are trying to see
   * how the next few rounds might fall.
   */
  resumeLive: boolean;
}

/** The leagues this copy ships knowing about, blank until one is loaded. */
const blank = (id: string, name: string): SavedLeague => ({
  id,
  name,
  settings: null,
  fetchedAt: null,
  rankingSource: null,
  keepers: [],
  pendingKeepers: [],
  tradedPicks: [],
  myUserId: null,
  slots: [],
});

/**
 * The leagues set in the environment, ready for the browser to keep.
 *
 * Empty unless `VITE_SEED_LEAGUES` says otherwise, which is the case for every
 * checkout but your own. See `config.ts`.
 */
export const SEED_LEAGUES: SavedLeague[] = CONFIGURED_LEAGUES.map((l) => blank(l.id, l.name));

export function defaultLeague(): LeagueConfig {
  return {
    teams: 12,
    rounds: rosterSize(DEFAULT_ROSTER),
    mySlot: 6,
    draftType: 'snake',
    scoring: 'half-ppr',
    adpSource: 'sleeper',
    year: new Date().getFullYear(),
    roster: { ...DEFAULT_ROSTER },
    seed: Math.floor(Math.random() * 1e9),
    teamNames: null,
    tradedPicks: null,
  };
}

export function defaults(): Saved {
  return {
    mode: 'mock',
    anonymous: false,
    league: defaultLeague(),
    cpu: { ...DEFAULT_CPU, positionBias: { ...DEFAULT_CPU.positionBias } },
    rankings: null,
    rankingSource: null,
    noteSource: null,
    overrides: {},
    savedLeagues: SEED_LEAGUES.map((l) => ({ ...l })),
    activeLeagueId: null,
    cpuPreset: 'market',
    pace: 140,
    myManager: DEFAULT_MANAGER,
    resumeLive: false,
  };
}

export function load(): Saved {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Saved>;

    // Any league this copy ships with that the browser has not seen yet gets
    // added, so a new default league appears without wiping what you saved.
    const leagues = [...(saved.savedLeagues || [])];
    for (const seed of SEED_LEAGUES) {
      if (!leagues.some((l) => l.id === seed.id)) leagues.push({ ...seed });
    }

    return {
      ...base,
      ...saved,
      league: {
        ...base.league,
        ...(saved.league || {}),
        roster: { ...base.league.roster, ...(saved.league?.roster || {}) },
      },
      cpu: {
        ...base.cpu,
        ...(saved.cpu || {}),
        positionBias: { ...base.cpu.positionBias, ...(saved.cpu?.positionBias || {}) },
      },
      overrides: saved.overrides || {},
      noteSource: saved.noteSource ?? null,
      myManager: saved.myManager ?? DEFAULT_MANAGER,
      resumeLive: saved.resumeLive ?? false,
      // Older saves predate the per league fields. Fill them rather than let a
      // missing array reach a component that maps over it.
      savedLeagues: leagues.map((l) => ({
        ...l,
        rankingSource: l.rankingSource ?? null,
        keepers: l.keepers ?? [],
        pendingKeepers: l.pendingKeepers ?? [],
        tradedPicks: l.tradedPicks ?? [],
        myUserId: l.myUserId ?? null,
        slots: l.slots ?? [],
      })),
    };
  } catch {
    return base;
  }
}

export function save(state: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // A full or blocked storage is not worth interrupting a draft over.
  }
}
