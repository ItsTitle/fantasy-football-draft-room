// One place to decide when two records name the same football player.
//
// The two upstream sources disagree in three ways, and every one of them is
// silent if you ignore it:
//   1. Suffixes. "Marvin Harrison Jr." against "Marvin Harrison".
//   2. Kickers. Fantasy Football Calculator says PK, Sleeper says K.
//   3. Team defences. Fantasy Football Calculator says "Seattle Defense",
//      Sleeper says "Seattle Seahawks". No name match will ever work, so
//      defences join on the team abbreviation instead.

const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b/g;

/** Reduce a player name to a comparable form. */
export function normName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.'`’]/g, '')
    .replace(SUFFIX, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reduce a position label to the six the draft engine knows. */
export function normPos(pos) {
  const p = String(pos || '').toUpperCase().trim();
  if (p === 'PK') return 'K';
  if (p === 'DST' || p === 'D/ST' || p === 'DEFENSE') return 'DEF';
  if (p === 'FB') return 'RB';
  return p;
}

const TEAM_FIX = { JAC: 'JAX', WSH: 'WAS', LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR' };

/** Reduce a team abbreviation to the form both sources agree on. */
export function normTeam(team) {
  const t = String(team || '').toUpperCase().trim();
  return TEAM_FIX[t] || t;
}

/**
 * The key a player joins on.
 * Defences join on the team. Everyone else joins on name plus position.
 */
export function joinKey(name, pos, team) {
  const p = normPos(pos);
  if (p === 'DEF') return `DEF|${normTeam(team)}`;
  return `${normName(name)}|${p}`;
}

/**
 * Every NFL team, by every name a ranking file calls it.
 *
 * Team defences are the one position where no name match can work. Fantasy
 * Football Calculator writes "Seattle Defense", Sleeper writes "Seattle
 * Seahawks", and a ranking export is as likely to write "SEA DST" or
 * "Washington D/ST". They all mean a team, so they all resolve to a team.
 */
const TEAM_NAMES = {
  ARI: ['arizona', 'cardinals'],
  ATL: ['atlanta', 'falcons'],
  BAL: ['baltimore', 'ravens'],
  BUF: ['buffalo', 'bills'],
  CAR: ['carolina', 'panthers'],
  CHI: ['chicago', 'bears'],
  CIN: ['cincinnati', 'bengals'],
  CLE: ['cleveland', 'browns'],
  DAL: ['dallas', 'cowboys'],
  DEN: ['denver', 'broncos'],
  DET: ['detroit', 'lions'],
  GB: ['green bay', 'packers', 'greenbay'],
  HOU: ['houston', 'texans'],
  IND: ['indianapolis', 'colts'],
  JAX: ['jacksonville', 'jaguars', 'jac'],
  KC: ['kansas city', 'chiefs', 'kansascity'],
  LAC: ['la chargers', 'los angeles chargers', 'chargers', 'san diego'],
  LAR: ['la rams', 'los angeles rams', 'rams', 'st louis'],
  LV: ['las vegas', 'raiders', 'oakland', 'lasvegas'],
  MIA: ['miami', 'dolphins'],
  MIN: ['minnesota', 'vikings'],
  NE: ['new england', 'patriots', 'newengland'],
  NO: ['new orleans', 'saints', 'neworleans'],
  NYG: ['ny giants', 'new york giants', 'giants'],
  NYJ: ['ny jets', 'new york jets', 'jets'],
  PHI: ['philadelphia', 'eagles'],
  PIT: ['pittsburgh', 'steelers'],
  SEA: ['seattle', 'seahawks'],
  SF: ['san francisco', '49ers', 'niners', 'sanfrancisco', 'forty niners'],
  TB: ['tampa bay', 'buccaneers', 'bucs', 'tampa', 'tampabay'],
  TEN: ['tennessee', 'titans'],
  WAS: ['washington', 'commanders', 'wsh'],
};

const DEFENCE_WORDS = /\b(dst|def|defense|defence|d\/?st)\b/g;

/**
 * Work out which team a defence row means, from its name and its team column.
 * Returns an abbreviation, or an empty string when nothing resolves.
 */
export function defenceTeam(name, team) {
  const fromColumn = normTeam(team);
  if (TEAM_NAMES[fromColumn]) return fromColumn;

  // Digits stay: "49ers" is a name, not a number.
  const text = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 /]/g, ' ')
    .replace(DEFENCE_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';

  // An abbreviation written straight into the name, as in "WAS DST".
  const upper = normTeam(text.toUpperCase().trim());
  if (TEAM_NAMES[upper]) return upper;

  // Whole words only. A substring test reads "Washington Commanders" as San
  // Francisco, because "commanders" ends in the letters of "49ers".
  const words = ' ' + text + ' ';
  for (const [abbr, aliases] of Object.entries(TEAM_NAMES)) {
    if (aliases.some((alias) => words.includes(' ' + alias + ' '))) return abbr;
  }
  return '';
}

/** The last word of a name, which is the part two sources rarely disagree on. */
export function surname(name) {
  const parts = normName(name).split(' ');
  return parts.length > 1 ? parts[parts.length - 1] : parts[0] || '';
}

/** The first word of a name. */
export function forename(name) {
  return normName(name).split(' ')[0] || '';
}

/**
 * The short forms that share too few letters to spot by prefix alone.
 * Every other pair is caught by the prefix rule below.
 */
const NICKNAMES = [
  ['michael', 'mike'], ['robert', 'bob'], ['robert', 'rob'], ['william', 'bill'],
  ['william', 'will'], ['richard', 'rick'], ['richard', 'dick'], ['edward', 'ted'],
  ['anthony', 'tony'], ['andrew', 'drew'], ['james', 'jim'], ['john', 'jack'],
  ['charles', 'chuck'], ['francis', 'frank'], ['lawrence', 'larry'],
  ['gabriel', 'gabe'], ['nathaniel', 'nate'], ['patrick', 'pat'],
];

/**
 * Do two first names plausibly belong to the same person?
 *
 * "Kenneth" against "Kenny", "Cameron" against "Cam" and "Michael" against
 * "Mike" are the same player under a different house style. The test is three
 * shared opening letters, plus a short table for the short forms that share
 * fewer than three.
 *
 * It refuses "Justin" against "Jordan". It is only ever applied once the
 * surname and the position already agree and exactly one candidate is left, so
 * it decides between one player and none, never between two players.
 */
export function forenamesAgree(a, b) {
  const x = forename(a);
  const y = forename(b);
  if (!x || !y) return false;
  if (x === y) return true;

  if (NICKNAMES.some(([full, short]) => (x === full && y === short) || (y === full && x === short))) {
    return true;
  }

  let shared = 0;
  while (shared < x.length && shared < y.length && x[shared] === y[shared]) shared += 1;
  return shared >= 3;
}

/**
 * How many single character edits turn one string into the other, giving up
 * once the answer is known to exceed `cap`.
 *
 * This is only ever used to offer suggestions, never to decide a match. A
 * misspelt surname finds nothing by any exact rule, and "no suggestions" is the
 * least helpful thing a screen asking you to pick a player can say.
 */
export function editDistance(a, b, cap = 3) {
  const x = String(a || '');
  const y = String(b || '');
  if (Math.abs(x.length - y.length) > cap) return cap + 1;
  if (x === y) return 0;

  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= y.length; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (row[j] < best) best = row[j];
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[y.length];
}
