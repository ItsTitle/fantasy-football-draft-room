// Sleeper: season projections, injury status and a deeper player pool.
//
// Fantasy Football Calculator publishes roughly 230 players, which covers a
// 12 team draft of 15 rounds and nothing longer. Sleeper publishes a Rotowire
// season projection for roughly 640 players, so it both extends the pool past
// the end of the market board and supplies the points the draft grade needs.
//
// Free, no key. The endpoint returns every player at a position; only the ones
// that carry `pts_half_ppr` are really projected. The rest are not projected to
// play and are dropped, not scored as zero.

import { cached } from '../cache.js';
import { normPos, normTeam, joinKey } from '../names.js';

const BASE = 'https://api.sleeper.app/projections/nfl';
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Which projected points column each scoring format reads. */
const POINTS_FIELD = {
  standard: 'pts_std',
  'half-ppr': 'pts_half_ppr',
  ppr: 'pts_ppr',
  // 2QB is a roster shape, not a scoring rule. Half PPR is the common pairing.
  '2qb': 'pts_half_ppr',
  dynasty: 'pts_half_ppr',
  rookie: 'pts_half_ppr',
};

/**
 * Which Sleeper ADP column each scoring format reads.
 *
 * `adp_dynasty` looks like the right field for dynasty and is not: it holds the
 * 999 placeholder for every player Sleeper returns. The scored dynasty numbers
 * live in the per format columns, and `adp_dynasty_half_ppr` carries 476 of
 * them. `adp_rookie` is empty for everybody, which is why rookie drafts are not
 * offered at all rather than offered with nothing in them.
 */
export const ADP_FIELD = {
  standard: 'adp_std',
  'half-ppr': 'adp_half_ppr',
  ppr: 'adp_ppr',
  '2qb': 'adp_2qb',
  dynasty: 'adp_dynasty_half_ppr',
};

/**
 * Where to look when the chosen format has no ADP for a player.
 *
 * The columns are not equally populated. Half PPR carries 529 players, standard
 * carries 310. A tight end with a half PPR ADP and no standard one is not a
 * player who does not exist in standard leagues; he is a player nobody bothered
 * to record separately. Dropping him left real, rostered players off the board
 * and reported them to the user as names that matched nothing.
 *
 * Every column counts picks in the same units, so a borrowed number sits on the
 * same scale. The board records which column each ADP came from.
 */
const FALLBACK_ORDER = ['half-ppr', 'ppr', 'standard', '2qb', 'dynasty'];

export async function fetchProjections({ year, force = false }) {
  const rows = [];
  let fetchedAt = 0;
  let stale = false;

  for (const pos of POSITIONS) {
    const entry = await cached(`sleeper_${year}_${pos}`, MAX_AGE_MS, async () => {
      const url = `${BASE}/${year}?season_type=regular&position%5B%5D=${pos}&order_by=pts_half_ppr`;
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`Sleeper returned ${res.status} for ${pos}`);
      return res.json();
    }, force);

    fetchedAt = Math.max(fetchedAt, entry.fetchedAt);
    stale = stale || !!entry.stale;
    for (const rec of entry.value || []) rows.push(rec);
  }

  return { rows, fetchedAt, stale };
}

/**
 * Turn the raw payload into one record per projected player, keyed for the join.
 * @param {object[]} rows
 * @param {string} format scoring format
 */
export function projectionMap(rows, format) {
  const pointsField = POINTS_FIELD[format] || 'pts_half_ppr';
  const adpField = ADP_FIELD[format] || 'adp_half_ppr';
  const out = new Map();

  for (const rec of rows) {
    const s = rec.stats || {};
    if (s.pts_half_ppr == null) continue; // Not projected to play.

    const p = rec.player || {};
    const position = normPos(p.position);
    if (!position) continue;

    const team = normTeam(rec.team || p.team);
    const name = position === 'DEF'
      ? `${p.first_name || ''} ${p.last_name || ''}`.trim()
      : `${p.first_name || ''} ${p.last_name || ''}`.trim();

    // Sleeper parks unranked players at 999. That is a placeholder, not a pick.
    const read = (field) => {
      const v = s[field];
      return v != null && v < 900 ? v : null;
    };

    let adp = read(adpField);
    let adpFrom = adp != null ? format : null;
    if (adp == null) {
      for (const other of FALLBACK_ORDER) {
        if (other === format) continue;
        const borrowed = read(ADP_FIELD[other]);
        if (borrowed != null) {
          adp = borrowed;
          adpFrom = other;
          break;
        }
      }
    }

    const record = {
      key: joinKey(name, position, team),
      sleeperId: String(rec.player_id),
      name,
      position,
      team,
      points: Number(s[pointsField] ?? s.pts_half_ppr ?? 0),
      gamesProjected: Number(s.gp ?? 0),
      sleeperAdp: adp,
      sleeperAdpFrom: adpFrom,
      injuryStatus: p.injury_status || null,
      yearsExp: p.years_exp ?? null,
    };

    // Sleeper ships duplicate person records. The better projection wins.
    const prior = out.get(record.key);
    if (!prior || record.points > prior.points) out.set(record.key, record);
  }

  return out;
}
