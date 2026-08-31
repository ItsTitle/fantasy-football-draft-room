// Read a real Sleeper league and turn it into draft settings.
//
// Sleeper publishes a league and its draft without a key, so setting the
// simulator to match a league you actually play in is a league ID and nothing
// else. Two endpoints carry everything that matters:
//
//   /v1/league/<id>   the roster shape and the scoring rules
//   /v1/draft/<id>    the order, the number of rounds and the reversal round
//
// Anything the simulator cannot model is reported as a warning rather than
// quietly dropped. A league that imports with a wrong roster is worse than one
// that refuses to import.

import { cached } from './cache.js';

const BASE = 'https://api.sleeper.app/v1';
const MAX_AGE_MS = 30 * 60 * 1000;

/** Sleeper's roster slot names, mapped to the ones the simulator knows. */
const SLOT_MAP = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'K',
  DEF: 'DEF',
  FLEX: 'FLEX',
  WRRB_FLEX: 'FLEX',
  REC_FLEX: 'FLEX',
  WRRB_WRT: 'FLEX',
  SUPER_FLEX: 'SUPERFLEX',
  BN: 'BENCH',
};

/** Slots that exist on a Sleeper roster but are never drafted. */
const NOT_DRAFTED = new Set(['IR', 'TAXI']);

/** Individual defensive player slots. The board has no defensive players. */
const IDP = new Set(['DL', 'LB', 'DB', 'IDP_FLEX', 'DEF_FLEX', 'CB', 'S', 'DE', 'DT']);

async function get(path, force) {
  const entry = await cached('sleeper_league_' + path.replace(/\//g, '_'), MAX_AGE_MS, async () => {
    const res = await fetch(BASE + path, { headers: { accept: 'application/json' } });
    if (res.status === 404) throw new Error('Sleeper has no league with that ID.');
    if (!res.ok) throw new Error('Sleeper returned ' + res.status + '.');
    const body = await res.json();
    if (!body) throw new Error('Sleeper has no league with that ID.');
    return body;
  }, force);
  return entry.value;
}

/** Which scoring board this league's rules point at. */
function readScoring(league, roster) {
  const rec = Number(league.scoring_settings?.rec ?? 0);

  // A superflex league is a different draft board, not a different points rule.
  // Quarterbacks go two rounds earlier and no PPR board reflects that.
  if (roster.SUPERFLEX > 0) return { scoring: '2qb', note: 'superflex' };

  if (rec >= 0.9) return { scoring: 'ppr', note: null };
  if (rec >= 0.4) return { scoring: 'half-ppr', note: null };
  return { scoring: 'standard', note: null };
}

/**
 * Fetch a league and return everything the settings screen needs.
 * @param {string} id a Sleeper league ID
 */
export async function importLeague(id, force = false) {
  const clean = String(id).trim();
  if (!/^\d{6,25}$/.test(clean)) {
    throw new Error('A Sleeper league ID is a long run of digits. Check the one you pasted.');
  }

  const league = await get('/league/' + clean, force);
  const warnings = [];

  const roster = {
    QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DEF: 0, BENCH: 0,
  };
  let idpSlots = 0;
  let recFlex = 0;

  for (const slot of league.roster_positions || []) {
    if (NOT_DRAFTED.has(slot)) continue;
    if (IDP.has(slot)) { idpSlots += 1; continue; }
    const mapped = SLOT_MAP[slot];
    if (!mapped) { warnings.push('Sleeper slot "' + slot + '" has no equal here and was left out.'); continue; }
    if (slot === 'REC_FLEX') recFlex += 1;
    roster[mapped] += 1;
  }

  const { scoring } = readScoring(league, roster);

  let draft = null;
  if (league.draft_id) {
    try {
      draft = await get('/draft/' + league.draft_id, force);
    } catch {
      warnings.push('The draft for this league could not be read. Rounds follow the roster instead.');
    }
  }

  const rosterTotal = Object.values(roster).reduce((a, b) => a + b, 0);
  const rounds = Number(draft?.settings?.rounds) || rosterTotal;

  let draftType = 'snake';
  if (draft?.type === 'linear') draftType = 'linear';
  if (Number(draft?.settings?.reversal_round) > 0) draftType = 'third-round-reversal';
  if (draft?.type === 'auction') {
    warnings.push('This is an auction draft. The simulator runs a snake instead.');
  }

  if (idpSlots) {
    warnings.push(idpSlots + ' individual defensive player slots were left out. '
      + 'The ADP feeds do not rank defensive players.');
  }
  if (recFlex) {
    warnings.push('A receiver flex was read as a normal flex, so a running back can fill it here '
      + 'and cannot in your league.');
  }
  if (Number(league.settings?.type) === 1 && Number(league.settings?.max_keepers) > 0) {
    warnings.push('This is a keeper league with up to '
      + league.settings.max_keepers + ' keeper' + (league.settings.max_keepers === 1 ? '' : 's')
      + ' a team. Enter them below or the draft starts from a board those players are still on.');
  }
  if (league.settings?.best_ball) {
    warnings.push('This is a best ball league. The draft is the same; there are no lineups to set.');
  }
  const bonuses = Object.keys(league.scoring_settings || {}).filter((k) => k.startsWith('bonus'));
  if (bonuses.length) {
    warnings.push(bonuses.length + ' bonus scoring rules are not in the projections, '
      + 'so the projected points are a little low for the players who earn them.');
  }
  if (rounds !== rosterTotal) {
    warnings.push('The draft runs ' + rounds + ' rounds for a roster of ' + rosterTotal + '.');
  }

  return {
    id: clean,
    draftId: league.draft_id ? String(league.draft_id) : null,
    previousLeagueId: league.previous_league_id ? String(league.previous_league_id) : null,
    isKeeper: Number(league.settings?.type) === 1,
    maxKeepers: Number(league.settings?.max_keepers) || 0,
    name: league.name || 'Sleeper league',
    season: league.season || null,
    status: league.status || null,
    teams: Number(league.total_rosters) || 12,
    rounds,
    roster,
    scoring,
    draftType,
    rosterPositions: league.roster_positions || [],
    receptionPoints: Number(league.scoring_settings?.rec ?? 0),
    warnings,
  };
}
