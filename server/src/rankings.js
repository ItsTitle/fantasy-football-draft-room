// Read a rankings file the user exports from anywhere and match it to the board.
//
// Every ranking site exports a different header row, so the column names are
// detected rather than required.
//
// HOW A ROW FINDS ITS PLAYER
// Six tiers, tried in order, and every match records which tier found it so the
// user can review anything that was not an exact hit:
//
//   override   the user said so. Always wins.
//   exact      name and position agree, or for a defence, the team agrees.
//   name       the name alone is unique on the board.
//   team       surname, position and team agree and only one player is left.
//   nickname   surname and position agree, only one player is left, and the
//              first names share an opening. "Kenneth Gainwell" is "Kenny
//              Gainwell"; "Cameron Ward" is "Cam Ward".
//   loose      the file had no position column and the name is unique.
//
// A row that clears none of them is reported with the closest players on the
// board beside it, so the user can map it once and never again. It is never
// guessed at. A silent miss drops a player off your board and you never learn
// which one.

import {
  defenceTeam, editDistance, forenamesAgree, joinKey, normName, normPos, normTeam, surname,
} from './names.js';

// HOW MUCH OF A FILE IS READ
// A ranking file is a board, and no board runs past a few hundred players. The
// two caps below are here because the row that matches nothing is the expensive
// one: it walks the whole pool to offer a suggestion. Without a cap, a body of
// junk names costs the pool size per row and stalls every other request for as
// long as it runs.

/** Rows read from one file. A deep board is about 400. */
const MAX_ROWS = 2000;

/** Unmatched rows offered a suggestion. Past this nobody is still reading. */
const MAX_SUGGESTED = 100;

/** Split one CSV line, honouring quoted fields. */
function splitLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === '	') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/*
 * WHICH COLUMN IS WHICH
 *
 * Header names are scored rather than matched, because the exact word is
 * usually not there. A real export reads:
 *
 *   Player, Position, Team, ETR Rank, ADP, Ranking Diff, ETR Pos Rank,
 *   ADP Pos Rank, Pos Rank Diff, id
 *
 * Six of those ten columns contain the word "rank" and only one of them is the
 * ranking. Matching "rank" exactly finds none of them and falls through to ADP,
 * which silently sorts your board into market order and calls it yours. So each
 * candidate carries a weight, a header can be disqualified outright, and the
 * best score wins.
 */

const NEVER_RANK = ['diff', 'pos rank', 'posrank', 'tier', 'bye', 'age', 'id'];
const NEVER_NAME = ['pos', 'team', 'rank', 'bye', 'tier', 'id', 'diff'];
const NEVER_POS = ['rank', 'diff', 'id'];

/** Weighted candidates, highest first. An exact hit beats a contains hit. */
const NAME_COLS = [
  ['player name', 100], ['full name', 100], ['player', 95], ['name', 90],
  ['fullname', 90], ['playername', 90],
];
const POS_COLS = [['position', 100], ['pos', 95]];
const TEAM_COLS = [['team', 100], ['tm', 90], ['nfl team', 90]];
const RANK_COLS = [
  ['overall rank', 100], ['rank', 95], ['rk', 95], ['overall', 90], ['ovr', 90],
  ['#', 60], ['adp', 40], ['avg', 35],
];
const TIER_COLS = [['tier', 100]];

/**
 * Pick the column that best fits a role.
 *
 * An exact header scores its full weight, a header that merely contains the
 * word scores four fifths of it, and a disqualifying word drops the column
 * entirely. Returns -1 when nothing scores.
 */
function findColumn(header, candidates, banned = []) {
  let bestIndex = -1;
  let bestScore = 0;

  header.forEach((h, i) => {
    if (!h) return;
    if (banned.some((word) => h.includes(word))) return;

    let score = 0;
    for (const [word, weight] of candidates) {
      if (h === word) score = Math.max(score, weight);
      else if (h.includes(word)) score = Math.max(score, Math.round(weight * 0.8));
    }
    // A shorter header that scores the same is the more likely one:
    // "Rank" beats "ETR Rank" beats "Weekly Rank Notes".
    if (score > bestScore || (score === bestScore && score > 0 && h.length < header[bestIndex].length)) {
      bestScore = score;
      bestIndex = i;
    }
  });

  return bestIndex;
}

/**
 * A position label often arrives fused to its rank, as in "RB4" or "WR12".
 * Return the letters only.
 */
function barePosition(value) {
  const m = String(value || '').match(/^([A-Za-z/]+)/);
  return m ? normPos(m[1]) : '';
}

/**
 * The key an override is stored under.
 *
 * Normalised name plus position, so the same mapping keeps working when the
 * next export writes the name in a different case or drops a full stop.
 */
export function overrideKey(name, position) {
  return normName(name) + '|' + (normPos(position) || '');
}

/** Build the lookup structures the tiers read. */
function indexPool(pool) {
  const byKey = new Map();
  const byName = new Map();
  const bySurname = new Map();

  const push = (map, key, player) => {
    const list = map.get(key) || [];
    list.push(player);
    map.set(key, list);
  };

  for (const p of pool) {
    byKey.set(p.key, p);
    if (p.position === 'DEF') continue;
    push(byName, normName(p.name), p);
    push(bySurname, surname(p.name), p);
  }

  return { byKey, byName, bySurname };
}

/** The one candidate left, or null when the list is empty or ambiguous. */
function only(list) {
  return list.length === 1 ? list[0] : null;
}

/**
 * The players a user is most likely to have meant, best first.
 *
 * The surname carries most of the weight, and it is compared by edit distance
 * rather than equality: the names that reach this function have already failed
 * every exact rule, and a good half of them failed because of a typo.
 * "Jonathin Tayler" has to reach Jonathan Taylor or the screen asking you to
 * pick a player is asking you to scroll six hundred names.
 */
function suggest(pool, name, position) {
  const wantSurname = surname(name);
  const wantName = normName(name);
  const scored = [];

  for (const p of pool) {
    if (p.position === 'DEF') continue;

    let score = 0;
    const theirSurname = surname(p.name);

    if (theirSurname === wantSurname) score += 100;
    else {
      const gap = editDistance(theirSurname, wantSurname, 2);
      if (gap <= 2) score += 70 - gap * 22;
      else if (editDistance(normName(p.name), wantName, 3) <= 3) score += 35;
      else continue;
    }

    if (position && p.position === position) score += 30;
    else if (position) score -= 25;
    if (forenamesAgree(p.name, wantName)) score += 25;

    if (score > 0) scored.push({ player: p, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.player.adp - b.player.adp)
    .slice(0, 5)
    .map(({ player }) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      team: player.team,
      adp: player.adp,
    }));
}

/**
 * Parse a pasted ranking list and match it to the board.
 *
 * Accepts a header row, or no header row at all. Without a header the rows are
 * read as "one player per line, best first" and the line number is the rank.
 *
 * @param {string} text       the pasted file
 * @param {object[]} pool     the board to match against
 * @param {Record<string, string|null>} overrides
 *        keyed by `overrideKey`. A player id maps the name to that player. An
 *        explicit null means the user chose to leave the name out for good.
 * @param {number|null} rankColumn
 *        the index of the column holding the rank, when the user has picked one
 *        by hand. Detection runs when this is null.
 */
export function parseRankings(text, pool, overrides = {}, rankColumn = null) {
  const all = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const lines = all.slice(0, MAX_ROWS);
  const truncated = all.length - lines.length;

  if (!lines.length) {
    return {
      entries: [], unmatched: [], ignored: [], columns: {}, matchRate: 0, tiers: {},
      error: 'The file is empty.',
    };
  }

  // A byte order mark on the first header would stop "Player" matching.
  const first = splitLine(lines[0].replace(/^﻿/, ''))
    .map((h) => h.toLowerCase().replace(/[_.]/g, ' ').replace(/\s+/g, ' ').trim());
  const nameCol = findColumn(first, NAME_COLS, NEVER_NAME);
  const hasHeader = nameCol >= 0;

  const columns = hasHeader
    ? {
      name: nameCol,
      position: findColumn(first, POS_COLS, NEVER_POS),
      team: findColumn(first, TEAM_COLS),
      // The caller can say which column holds the rank. Detection is good and
      // it is not infallible, and a board sorted by the wrong column looks
      // exactly like a board sorted by the right one.
      rank: rankColumn != null && rankColumn >= 0 && rankColumn < first.length
        ? rankColumn
        : findColumn(first, RANK_COLS, NEVER_RANK),
      tier: findColumn(first, TIER_COLS),
    }
    : { name: 0, position: -1, team: -1, rank: -1, tier: -1 };

  const rows = hasHeader ? lines.slice(1) : lines;
  const index = indexPool(pool);
  const byId = new Map(pool.map((p) => [p.id, p]));

  const entries = [];
  const unmatched = [];
  const ignored = [];
  const tiers = {};
  let order = 0;

  for (const line of rows) {
    const cells = splitLine(line);
    const rawName = (cells[columns.name] || '').replace(/\s*\(.*\)$/, '').trim();
    if (!rawName) continue;
    order += 1;

    const rawRank = columns.rank >= 0 ? parseFloat(cells[columns.rank]) : NaN;
    const rank = Number.isFinite(rawRank) ? rawRank : order;
    const tierValue = columns.tier >= 0 ? parseInt(cells[columns.tier], 10) : null;
    const position = columns.position >= 0 ? barePosition(cells[columns.position]) : '';
    const team = normTeam(columns.team >= 0 ? cells[columns.team] : '');

    const key = overrideKey(rawName, position);
    let hit = null;
    let tier = null;

    // 0. The user has already said what this name means.
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      const target = overrides[key];
      if (target === null) {
        ignored.push({ name: rawName, position: position || null, key });
        continue;
      }
      hit = byId.get(target) || null;
      if (hit) tier = 'override';
    }

    // A defence is a team, whatever the file calls it.
    if (!hit && (position === 'DEF' || /\b(dst|d\/?st|defense|defence)\b/i.test(rawName))) {
      const abbr = defenceTeam(rawName, team);
      if (abbr) {
        hit = index.byKey.get('DEF|' + abbr) || null;
        if (hit) tier = 'exact';
      }
    }

    if (!hit && position) {
      hit = index.byKey.get(joinKey(rawName, position, team)) || null;
      if (hit) tier = 'exact';
    }

    if (!hit) {
      const named = index.byName.get(normName(rawName)) || [];
      hit = only(position ? named.filter((c) => c.position === position) : named);
      if (hit) tier = position ? 'name' : 'loose';
    }

    if (!hit && position) {
      const family = index.bySurname.get(surname(rawName)) || [];
      const samePosition = family.filter((c) => c.position === position);

      if (team) {
        hit = only(samePosition.filter((c) => c.team === team));
        if (hit) tier = 'team';
      }
      if (!hit) {
        const plausible = samePosition.filter((c) => forenamesAgree(c.name, rawName));
        hit = only(plausible);
        if (hit) tier = 'nickname';
      }
    }

    if (!hit) {
      unmatched.push({
        name: rawName,
        position: position || null,
        team: team || null,
        rank,
        key,
        suggestions: unmatched.length < MAX_SUGGESTED
          ? suggest(pool, rawName, position)
          : [],
      });
      continue;
    }

    tiers[tier] = (tiers[tier] || 0) + 1;
    entries.push({
      id: hit.id,
      key: hit.key,
      name: hit.name,
      position: hit.position,
      rank,
      tier: Number.isFinite(tierValue) ? tierValue : null,
      sourceName: rawName,
      matchedBy: tier,
      overrideKey: key,
    });
  }

  // A file can name the same player twice, and an override can point two names
  // at one player. The better rank wins and the loser is dropped, because a
  // board cannot hold one player in two places.
  const best = new Map();
  for (const e of entries) {
    const prior = best.get(e.id);
    if (!prior || e.rank < prior.rank) best.set(e.id, e);
  }

  const deduped = [...best.values()].sort((a, b) => a.rank - b.rank);
  deduped.forEach((e, i) => { e.rank = i + 1; });

  const considered = deduped.length + unmatched.length;

  return {
    entries: deduped,
    unmatched,
    ignored,
    tiers,
    duplicates: entries.length - deduped.length,
    // Rows past MAX_ROWS that were never read. Nothing shows this yet; it is
    // here so a silently shortened board is at least reported, not hidden.
    truncated,
    columns: {
      detectedHeader: hasHeader,
      name: hasHeader ? first[columns.name] : 'line order',
      position: columns.position >= 0 ? first[columns.position] : null,
      team: columns.team >= 0 ? first[columns.team] : null,
      rank: columns.rank >= 0 ? first[columns.rank] : 'line order',
      rankIndex: columns.rank,
      rankWasChosen: rankColumn != null,
      tier: columns.tier >= 0 ? first[columns.tier] : null,
      // Every header, so the user can point at a different one.
      headers: hasHeader ? first : [],
    },
    matchRate: considered ? Number((deduped.length / considered).toFixed(3)) : 0,
  };
}
