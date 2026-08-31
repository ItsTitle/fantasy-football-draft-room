export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';

export const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export interface Player {
  id: string;
  key: string;
  name: string;
  position: Position;
  team: string;
  bye: number | null;
  adp: number;
  adpRank: number;
  adpStdev: number;
  stdevMeasured: boolean;
  points: number | null;
  /** Set when this player has no ADP in the chosen format and one was borrowed. */
  adpBorrowedFrom: string | null;
  ffcAdp: number | null;
  sleeperAdp: number | null;
  injuryStatus: string | null;
  timesDrafted: number;
  sources: string[];
}

export interface BoardMeta {
  source: string;
  sourceUrl: string;
  format: string;
  formatLabel: string;
  adpSource: string;
  adpSourceLabel: string;
  adpLeagueSize: number;
  requestedLeagueSize: number;
  year: number;
  totalDrafts: number | null;
  window: string | null;
  poolSize: number;
  positionCounts: Record<string, number>;
  ffcPoolSize: number;
  sleeperPoolSize: number;
  joinMatched: number;
  joinRate: number;
  withProjectedPoints: number;
  /** How many players carry an ADP read from a format other than this one. */
  adpBorrowed: number;
  fetchedAt: number;
  stale: boolean;
}

export interface Board {
  players: Player[];
  meta: BoardMeta;
}

/** Starting slots plus bench. The sum is how many rounds the draft runs. */
export interface RosterSlots {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number;
  SUPERFLEX: number;
  K: number;
  DEF: number;
  BENCH: number;
}

export type DraftType = 'snake' | 'linear' | 'third-round-reversal';

/**
 * What a run of this app is.
 *
 *   mock       a simulated room drafts against you, so you can rehearse
 *   assistant  nothing is simulated; the board mirrors your real Sleeper draft
 */
export type AppMode = 'mock' | 'assistant';

export interface LeagueConfig {
  teams: number;
  rounds: number;
  mySlot: number;
  draftType: DraftType;
  scoring: string;
  adpSource: string;
  year: number;
  roster: RosterSlots;
  seed: number;
  /**
   * What each seat is really called, index 0 being slot 1.
   *
   * Read from the league when there is one. A board that says "The Waiver
   * Wire Warriors" tells you who just took the back at your turn; a board
   * that says "Team 4" does not.
   */
  teamNames: string[] | null;
  /**
   * Picks that changed hands, read from the league. Null in a plain mock.
   *
   * These decide who is on the clock at every pick, so they belong beside the
   * draft type rather than off to one side: both answer the same question.
   */
  tradedPicks: TradedPick[] | null;
}

/** Every dial that changes how the computer teams draft. */
export interface CpuConfig {
  /** Per position, -5 avoids the position and +5 forces it. 0 follows ADP. */
  positionBias: Record<Position, number>;
  /** 0 drafts the board exactly. 3 matches real draft variance. 10 is chaos. */
  randomness: number;
  /** 0 ignores the roster. 5 balances it. 10 fills starting slots first. */
  needWeight: number;
  /** Let the computer teams draft from your uploaded rankings too. */
  cpuUsesMyRankings: boolean;
}

export interface DraftPick {
  overall: number;
  round: number;
  slotInRound: number;
  teamIndex: number;
  playerId: string;
  auto: boolean;
  /** Set when the pick was fixed in advance rather than made here. */
  preset: PresetSource | null;
}

/**
 * Why a pick was already decided before the simulator reached it.
 *
 *   keeper  a player kept from last season, off the board before pick one
 *   live    a pick that really happened in your Sleeper draft
 *   manual  a pick you entered to catch up to a draft in progress
 */
export type PresetSource = 'keeper' | 'live' | 'manual';

/**
 * A pick that is settled before the draft runs.
 *
 * Keepers, a real draft being followed, and catching up to a draft already
 * under way are the same thing to the engine: somebody else already decided
 * this slot, so nobody simulates it.
 */
export interface PresetPick {
  overall: number;
  playerId: string;
  source: PresetSource;
}

/**
 * A pick that changed hands before the draft. Both slots are 1 based.
 *
 * A traded pick does not move in the order. It stays where the seat that
 * originally owned it sits, and somebody else makes it. That distinction is the
 * whole of this: the board still has one pick per seat per round, and a team
 * can arrive at a round holding two of them, or none.
 */
export interface TradedPick {
  round: number;
  /** The seat the pick belongs to by right, which fixes where it sits. */
  fromSlot: number;
  /** The seat that will actually make it. */
  toSlot: number;
}

/**
 * A keeper the import knows everything about except what he costs.
 *
 * Sleeper publishes who is kept and by whom, never the round. Most of them are
 * priced off last season's draft, and the ones that cannot be are the ones you
 * picked up on waivers or the ones whose round another keeper already holds.
 * They used to be counted in a sentence and dropped. They wait here instead,
 * with everything already filled in, until you say which round.
 */
export interface PendingKeeper {
  playerId: string;
  /** The draft slot that keeps him, 1 based. */
  slot: number;
  name: string;
  position: string;
  team: string;
  /** Why the import could not settle it: no history, or the round was taken. */
  reason: 'no-history' | 'round-taken';
  /** The round that was tried and found occupied, when that is the reason. */
  triedRound: number | null;
}

export interface RankingEntry {
  id: string;
  key: string;
  name: string;
  position: Position;
  rank: number;
  tier: number | null;
  /** The name as your file wrote it, which is not always the board's name. */
  sourceName: string;
  /** Which tier found this player. Anything but `exact` is worth a glance. */
  matchedBy: 'override' | 'exact' | 'name' | 'team' | 'nickname' | 'loose';
  overrideKey: string;
}

/** A player the board holds who might be the one a failed name meant. */
export interface Suggestion {
  id: string;
  name: string;
  position: Position;
  team: string;
  adp: number;
}

export interface UnmatchedName {
  name: string;
  position: string | null;
  team: string | null;
  rank: number;
  /** The key an override is saved under. Survives case and punctuation. */
  key: string;
  suggestions: Suggestion[];
}

export interface RankingColumns {
  detectedHeader: boolean;
  name: string;
  position: string | null;
  team: string | null;
  rank: string;
  /** Which column index the rank was read from. -1 when the file had no header. */
  rankIndex: number;
  /** True when you picked the rank column yourself rather than letting it detect. */
  rankWasChosen: boolean;
  tier: string | null;
  headers: string[];
}

export interface RankingSet {
  label: string;
  entries: RankingEntry[];
  unmatched: UnmatchedName[];
  ignored: { name: string; position: string | null; key: string }[];
  tiers: Record<string, number>;
  duplicates: number;
  matchRate: number;
  columns: RankingColumns;
}

/**
 * Your own name to player mapping. A player id maps the name to that player.
 * An explicit null means "leave this name out and stop asking".
 */
export type Overrides = Record<string, string | null>;

/**
 * A Sleeper league you draft in, with its settings kept.
 *
 * A league's shape barely moves once the season is set, so the settings are
 * pulled once and then read from here. Loading a league is instant and works
 * with the network down. `Refresh from Sleeper` pulls again when you have
 * actually changed something over there.
 */
export interface SavedLeague {
  id: string;
  name: string;
  settings: LeagueImport | null;
  fetchedAt: number | null;
  /**
   * Everything that belongs to this league and not to the app.
   *
   * Your three leagues are standard, half PPR and PPR, and every ranking site
   * publishes a separate file per format, so a single ranking set would mean
   * re-uploading on every switch. Keepers are per league for the same reason.
   */
  rankingSource: import('../storage').RankingSource | null;
  keepers: PresetPick[];
  /** Imported keepers still waiting on the one thing Sleeper does not publish. */
  pendingKeepers: PendingKeeper[];
  /** Picks that changed hands, kept so a mock of this league runs true. */
  tradedPicks: TradedPick[];
  /** Which Sleeper manager is you, so a real draft knows which picks are yours. */
  myUserId: string | null;
  /** The seats and their team names, read from the league. */
  slots: LeagueSlot[];
}

/** Draft settings read straight out of a real Sleeper league. */
export interface LeagueImport {
  id: string;
  name: string;
  season: string | null;
  status: string | null;
  teams: number;
  rounds: number;
  roster: RosterSlots;
  scoring: string;
  draftType: DraftType;
  receptionPoints: number;
  draftId: string | null;
  isKeeper: boolean;
  maxKeepers: number;
  warnings: string[];
}

export interface LeagueMember {
  userId: string;
  name: string;
  teamName: string | null;
}

/** What a real Sleeper draft looks like right now. */
export interface LiveDraftState {
  draftId: string;
  status: string;
  type: string;
  started: boolean;
  complete: boolean;
  rounds: number;
  teams: number;
  slotByUser: Record<string, number>;
  orderIsSet: boolean;
}

export interface LivePick {
  overall: number;
  round: number;
  slot: number;
  rosterId: number | null;
  pickedBy: string | null;
  isKeeper: boolean;
  playerId: string;
  /** True when this board has never heard of the player who was taken. */
  offBoard: boolean;
  name: string;
  position: string;
  team: string;
}

/** One seat in a real league: who owns it and what they call the team. */
export interface LeagueSlot {
  slot: number;
  rosterId: number | null;
  userId: string | null;
  manager: string | null;
  name: string;
  named: boolean;
}

/** A keeper a manager has declared, before the draft turns it into a pick. */
export interface DeclaredKeeper {
  slot: number | null;
  rosterId: number;
  sleeperId: string;
  playerId: string | null;
  name: string | null;
  position: string | null;
  team: string | null;
  /** Where he went last season. Evidence for the cost, never a statement of it. */
  suggestedRound: number | null;
  suggestedFrom: string;
}

/** Everything a real league can tell us before its draft opens. */
export interface LeagueSetup {
  leagueId: string;
  teams: number;
  slots: LeagueSlot[];
  keepers: DeclaredKeeper[];
  keepersDeclared: number;
  maxKeepers: number;
  isKeeper: boolean;
  /** Picks traded before the draft, in this season only. */
  tradedPicks: TradedPick[];
  draft: (LiveDraftState & { startTime: number | null }) | null;
  namedTeams: number;
}

export interface LivePicks {
  picks: LivePick[];
  matched: number;
  unknown: { name: string; position: string; team: string }[];
  poolSize: number;
}
