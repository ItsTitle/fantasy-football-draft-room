// Fantasy Football Calculator: the market ADP source.
//
// Free, no key, commercial use allowed, and it asks only for attribution.
// It is the primary source here for one reason no other free feed matches:
// it reports a separate ADP for each scoring format AND each league size, and
// it reports the standard deviation of every pick. That deviation is what the
// simulator uses to decide how far a computer team is willing to reach.
//
// Attribution: https://fantasyfootballcalculator.com

import { cached } from '../cache.js';
import { normPos, normTeam, joinKey } from '../names.js';

const BASE = 'https://fantasyfootballcalculator.com/api/v1/adp';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * The formats this app offers.
 *
 * The service also publishes a rookie board. It is not listed here: it drew 37
 * drafts this window and returned zero players, and Sleeper's rookie ADP column
 * is empty for everybody. A format with no data behind it is worse than a
 * missing one, because the draft still runs and quietly means nothing.
 */
export const FORMATS = {
  standard: 'Standard',
  'half-ppr': 'Half PPR',
  ppr: 'PPR',
  '2qb': 'Superflex / 2QB',
  dynasty: 'Dynasty',
};

/** League sizes the service publishes. A draft of any size maps to one of these. */
export const SIZES = [8, 10, 12, 14];

/** Map any league size to the nearest size the service publishes. */
export function nearestSize(teams) {
  const n = Number(teams) || 12;
  return SIZES.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), SIZES[0]);
}

export async function fetchAdp({ format, teams, year, force = false }) {
  const size = nearestSize(teams);
  const key = `ffc_${format}_${size}_${year}`;

  const entry = await cached(key, MAX_AGE_MS, async () => {
    const url = `${BASE}/${format}?teams=${size}&year=${year}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Fantasy Football Calculator returned ${res.status}`);
    const body = await res.json();
    if (body.status !== 'Success') throw new Error('Fantasy Football Calculator returned no data');
    return body;
  }, force);

  const body = entry.value;
  const players = (body.players || []).map((p) => ({
    key: joinKey(p.name, p.position, p.team),
    name: p.name,
    position: normPos(p.position),
    team: normTeam(p.team),
    bye: p.bye || null,
    adp: p.adp,
    adpFormatted: p.adp_formatted,
    // How much real drafts disagree about this player. Small for the top of
    // round one, large for a rookie nobody has settled on.
    stdev: p.stdev || null,
    high: p.high || null,
    low: p.low || null,
    timesDrafted: p.times_drafted || 0,
  }));

  return {
    players,
    meta: {
      source: 'Fantasy Football Calculator',
      sourceUrl: 'https://fantasyfootballcalculator.com',
      format,
      formatLabel: FORMATS[format] || format,
      adpLeagueSize: size,
      requestedLeagueSize: Number(teams) || 12,
      year: Number(year),
      totalDrafts: body.meta?.total_drafts ?? null,
      window: body.meta ? `${body.meta.start_date} to ${body.meta.end_date}` : null,
      fetchedAt: entry.fetchedAt,
      stale: !!entry.stale,
    },
  };
}
