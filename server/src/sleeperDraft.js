// Read a real Sleeper draft: who is in it, whose turn it is, and every pick
// that has already happened.
//
// This is what lets the tool follow a draft you are actually in. The picks
// endpoint returns nothing until the draft opens and then grows one row per
// pick, so the client polls it and mirrors what it finds onto the board.
//
// Two things here are not cached at all. A draft in progress is the one piece
// of data in this app that is stale the moment it is read.

import { cached } from './cache.js';
import { buildBoard } from './board.js';
import { joinKey, normPos, normTeam } from './names.js';

const BASE = 'https://api.sleeper.app/v1';
const USERS_MAX_AGE_MS = 60 * 60 * 1000;
/** Rosters carry the declared keepers, which change up to the deadline. */
const ROSTER_MAX_AGE_MS = 10 * 60 * 1000;
/** Last season is over. Its draft will not change again. */
const HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function get(path) {
  const res = await fetch(BASE + path, { headers: { accept: 'application/json' } });
  if (res.status === 404) throw new Error('Sleeper has nothing at that ID.');
  if (!res.ok) throw new Error('Sleeper returned ' + res.status + '.');
  const body = await res.json();
  if (body == null) throw new Error('Sleeper has nothing at that ID.');
  return body;
}

/** The people in a league, so you can say which team is yours. */
export async function leagueUsers(leagueId, force = false) {
  const entry = await cached('sleeper_users_' + leagueId, USERS_MAX_AGE_MS,
    () => get('/league/' + leagueId + '/users'), force);

  return (entry.value || []).map((u) => ({
    userId: String(u.user_id),
    name: u.display_name || u.username || 'Manager',
    teamName: u.metadata?.team_name || null,
  }));
}

/**
 * The state of a draft: whether it has opened, and who sits in which slot.
 *
 * `draft_order` maps a user to a draft slot and stays empty until the order is
 * set, which for most leagues is minutes before the draft. Until then nobody
 * can be told which slot is theirs, and the app says so rather than guessing.
 */
export async function draftState(draftId) {
  const draft = await get('/draft/' + draftId);
  const order = draft.draft_order || {};

  return {
    draftId: String(draft.draft_id),
    status: draft.status,
    type: draft.type,
    started: draft.status !== 'pre_draft',
    complete: draft.status === 'complete',
    rounds: Number(draft.settings?.rounds) || 0,
    teams: Number(draft.settings?.teams) || 0,
    reversalRound: Number(draft.settings?.reversal_round) || 0,
    // user id to draft slot, 1 based. Empty until the order is drawn.
    slotByUser: Object.fromEntries(
      Object.entries(order).map(([userId, slot]) => [String(userId), Number(slot)]),
    ),
    orderIsSet: Object.keys(order).length > 0,
  };
}

/**
 * Every pick made so far, mapped onto the board this app drafts from.
 *
 * Sleeper's player id is the board id for anyone the board holds, so the join
 * is direct and needs none of the name matching the rest of the app does. A
 * pick of somebody the board has never heard of still comes back, named from
 * the pick's own metadata, so the board never silently drops a real pick.
 */
export async function draftPicks(draftId, boardQuery) {
  const [raw, board] = await Promise.all([
    get('/draft/' + draftId + '/picks'),
    buildBoard(boardQuery),
  ]);

  const byKey = new Map(board.players.map((p) => [p.key, p]));
  const bySleeperId = new Map();
  for (const p of board.players) {
    if (p.id.startsWith('sl-')) bySleeperId.set(p.id.slice(3), p);
  }

  const picks = [];
  const unknown = [];

  for (const pick of raw || []) {
    const meta = pick.metadata || {};
    const name = `${meta.first_name || ''} ${meta.last_name || ''}`.trim();
    const position = normPos(meta.position);
    const team = normTeam(meta.team);

    // The Sleeper id first, then the same name and position key the rest of the
    // app joins on. Team defences carry a team abbreviation as their player id.
    let player = bySleeperId.get(String(pick.player_id));
    if (!player) player = byKey.get(joinKey(name, position, team)) || null;
    if (!player && position === 'DEF') {
      player = byKey.get('DEF|' + normTeam(pick.player_id)) || null;
    }

    // A pick of somebody this board has never heard of still owns its slot.
    // Returning it without an id would leave a hole, and a board with a hole in
    // it is a board that no longer lines up with the real one.
    if (!player) {
      unknown.push({ name: name || String(pick.player_id), position, team });
    }

    picks.push({
      overall: Number(pick.pick_no),
      round: Number(pick.round),
      slot: Number(pick.draft_slot),
      rosterId: pick.roster_id != null ? Number(pick.roster_id) : null,
      pickedBy: pick.picked_by ? String(pick.picked_by) : null,
      isKeeper: !!pick.is_keeper,
      playerId: player ? player.id : 'off-' + String(pick.player_id),
      offBoard: !player,
      name: player ? player.name : (name || 'Unknown player'),
      position: player ? player.position : (position || 'RB'),
      team: player ? player.team : team,
    });
  }

  picks.sort((a, b) => a.overall - b.overall);

  return {
    picks,
    matched: picks.filter((p) => !p.offBoard).length,
    unknown,
    poolSize: board.players.length,
  };
}


/**
 * Where every player went in the previous season's draft.
 *
 * Sleeper does not publish what a keeper costs. Most leagues charge the round
 * the player was drafted in, so last season's draft is the best evidence there
 * is. It is offered as a suggestion and never as a fact: a league can charge a
 * round earlier, and a player picked up on waivers was never drafted at all.
 */
async function previousDraftRounds(leagueId) {
  try {
    const league = await cached('sleeper_league__league_' + leagueId, HISTORY_MAX_AGE_MS,
      () => get('/league/' + leagueId));
    const prevId = league.value?.previous_league_id;
    if (!prevId) return new Map();

    const prev = await cached('sleeper_prev_league_' + prevId, HISTORY_MAX_AGE_MS,
      () => get('/league/' + prevId));
    const draftId = prev.value?.draft_id;
    if (!draftId) return new Map();

    const picks = await cached('sleeper_prev_picks_' + draftId, HISTORY_MAX_AGE_MS,
      () => get('/draft/' + draftId + '/picks'));

    return new Map((picks.value || []).map((p) => [String(p.player_id), Number(p.round)]));
  } catch {
    // No history is a missing suggestion, not a failure.
    return new Map();
  }
}

/** Trades happen up to the draft, so this is read as often as the rosters. */
const TRADE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Picks that changed hands, as seats rather than rosters.
 *
 * Sleeper keys a traded pick by the roster that owned it originally, which is
 * what fixes where the pick sits: the seat that roster drafts from keeps the
 * slot, and somebody else makes the pick. `roster_id` is that original owner
 * and `owner_id` is whoever holds it now, however many hands it passed through.
 *
 * A pick traded away and later bought back comes through with both ids equal.
 * It is dropped rather than written as a swap to itself.
 */
async function tradedPicks(leagueId, season, rosterToSlot, force = false) {
  try {
    const entry = await cached('sleeper_trades_' + leagueId, TRADE_MAX_AGE_MS,
      () => get('/league/' + leagueId + '/traded_picks'), force);

    const out = [];
    for (const row of entry.value || []) {
      // Dynasty leagues trade future picks. Only this draft is being run.
      if (season && String(row.season) !== String(season)) continue;
      const fromSlot = rosterToSlot.get(Number(row.roster_id));
      const toSlot = rosterToSlot.get(Number(row.owner_id));
      if (!fromSlot || !toSlot || fromSlot === toSlot) continue;
      out.push({ round: Number(row.round), fromSlot, toSlot });
    }

    out.sort((a, b) => a.round - b.round || a.fromSlot - b.fromSlot);
    return out;
  } catch {
    // A league with no trades and a feed that did not answer look the same
    // here. Neither is worth failing the whole settings read over.
    return [];
  }
}

/**
 * Everything the settings screen needs about a real league in one answer:
 * who sits in which seat, what they call their team, and who they are keeping.
 *
 * The seat mapping runs slot to roster to owner to name. It deliberately does
 * not run through `draft_order`, which is keyed by user and misses anyone who
 * does not own a roster outright: this league has twelve seats and eleven
 * entries there, so one seat would have come back nameless.
 */
export async function leagueSetup(leagueId, boardQuery, force = false) {
  const [usersEntry, rostersEntry, leagueEntry] = await Promise.all([
    cached('sleeper_users_' + leagueId, USERS_MAX_AGE_MS,
      () => get('/league/' + leagueId + '/users'), force),
    cached('sleeper_rosters_' + leagueId, ROSTER_MAX_AGE_MS,
      () => get('/league/' + leagueId + '/rosters'), force),
    cached('sleeper_league__league_' + leagueId, HISTORY_MAX_AGE_MS,
      () => get('/league/' + leagueId), force),
  ]);

  const users = usersEntry.value || [];
  const rosters = rostersEntry.value || [];
  const league = leagueEntry.value || {};

  const nameByUser = new Map(users.map((u) => [String(u.user_id), {
    display: u.display_name || u.username || 'Manager',
    team: u.metadata?.team_name || null,
  }]));
  const rosterById = new Map(rosters.map((r) => [Number(r.roster_id), r]));

  let draft = null;
  if (league.draft_id) {
    try {
      draft = await draftState(league.draft_id);
    } catch { /* The draft may not exist yet. The seats still do. */ }
  }

  const rawDraft = league.draft_id
    ? (await cached('sleeper_draftraw_' + league.draft_id, 5 * 60 * 1000,
      () => get('/draft/' + league.draft_id), force)).value
    : null;

  const slotToRoster = rawDraft?.slot_to_roster_id || {};
  const teams = Number(league.total_rosters) || Object.keys(slotToRoster).length || 0;

  const slots = [];
  for (let slot = 1; slot <= teams; slot += 1) {
    const rosterId = Number(slotToRoster[slot]) || null;
    const roster = rosterId != null ? rosterById.get(rosterId) : null;
    const ownerId = roster?.owner_id ? String(roster.owner_id) : null;
    const who = ownerId ? nameByUser.get(ownerId) : null;
    slots.push({
      slot,
      rosterId,
      userId: ownerId,
      manager: who?.display || null,
      // The team name if they set one, their own name if they did not.
      name: who?.team || who?.display || 'Team ' + slot,
      named: !!who?.team,
    });
  }

  const rosterToSlot = new Map(slots.map((s) => [s.rosterId, s.slot]));
  const history = await previousDraftRounds(leagueId);
  const trades = await tradedPicks(leagueId, league.season, rosterToSlot, force);

  const board = await buildBoard(boardQuery);
  const bySleeperId = new Map();
  for (const p of board.players) {
    if (p.id.startsWith('sl-')) bySleeperId.set(p.id.slice(3), p);
  }

  const keepers = [];
  for (const roster of rosters) {
    for (const sleeperId of roster.keepers || []) {
      const id = String(sleeperId);
      const player = bySleeperId.get(id) || null;
      const round = history.get(id) || null;
      keepers.push({
        slot: rosterToSlot.get(Number(roster.roster_id)) ?? null,
        rosterId: Number(roster.roster_id),
        sleeperId: id,
        playerId: player ? player.id : null,
        name: player ? player.name : null,
        position: player ? player.position : null,
        team: player ? player.team : null,
        // Where he went last season. The best evidence for what he costs, and
        // still a guess: no league publishes its keeper rule.
        suggestedRound: round,
        suggestedFrom: round ? 'last season, round ' + round : 'never drafted here',
      });
    }
  }

  keepers.sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));

  return {
    leagueId: String(leagueId),
    teams,
    slots,
    keepers,
    keepersDeclared: keepers.length,
    tradedPicks: trades,
    maxKeepers: Number(league.settings?.max_keepers) || 0,
    isKeeper: Number(league.settings?.type) === 1,
    draft: draft ? { ...draft, startTime: rawDraft?.start_time ?? null } : null,
    namedTeams: slots.filter((s) => s.named).length,
  };
}
