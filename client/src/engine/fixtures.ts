/**
 * The real Sleeper leagues the live checks run against.
 *
 * Most of `selftest.ts` needs nothing but the data service. Three blocks need
 * a real league to read: one that imports several leagues, one that replays a
 * finished draft pick by pick, and one that reads a keeper league with traded
 * picks in it. Those leagues belong to whoever is running the checks, so they
 * are named in a file rather than written into the source.
 *
 * Copy `fixtures.example.json` to `fixtures.local.json`, which git ignores,
 * and fill it in. Without it those three blocks say they were skipped and the
 * rest of the checks run as normal.
 *
 *   TEST_FIXTURES=/some/other/path.json npm run engine:test
 */

import { readFileSync } from 'node:fs';

/** A league the import check reads, with the settings it must come back with. */
export interface LeagueFixture {
  id: string;
  teams: number;
  rounds: number;
  scoring: string;
}

/** A finished draft, which never changes again and so can be asserted exactly. */
export interface DraftFixture {
  id: string;
  /** How many picks the finished draft holds. */
  picks: number;
  /** How many of them are keepers. */
  keepers: number;
  /** The fewest picks that must find their player on today's board. */
  minMatched: number;
}

/**
 * A league rich enough to exercise the awkward parts: keepers, traded picks,
 * and a draft order shorter than the number of seats.
 */
export interface KeeperLeagueFixture {
  id: string;
  teams: number;
  rounds: number;
  scoring: string;
}

export interface Fixtures {
  leagues: LeagueFixture[];
  keeperLeague: KeeperLeagueFixture;
  finishedDraft: DraftFixture;
}

const PATH = process.env.TEST_FIXTURES || 'fixtures.local.json';

/**
 * Read the fixtures, or return null when there are none.
 *
 * A missing file is the ordinary case for anyone but the author, so it is not
 * an error. A file that exists and is wrong is an error, because a silent
 * skip there would hide a check the runner meant to run.
 */
export function loadFixtures(): Fixtures | null {
  let raw: string;
  try {
    raw = readFileSync(PATH, 'utf8');
  } catch {
    return null;
  }

  const parsed = JSON.parse(raw) as Partial<Fixtures>;
  if (!Array.isArray(parsed.leagues) || !parsed.leagues.length) {
    throw new Error(PATH + ' has no `leagues` array.');
  }
  if (!parsed.keeperLeague?.id) throw new Error(PATH + ' has no `keeperLeague.id`.');
  if (!parsed.finishedDraft?.id) throw new Error(PATH + ' has no `finishedDraft.id`.');

  return {
    leagues: parsed.leagues,
    keeperLeague: parsed.keeperLeague as KeeperLeagueFixture,
    finishedDraft: parsed.finishedDraft as DraftFixture,
  };
}

/** What to print when a block cannot run. */
export const NO_FIXTURES =
  '  skipped  no fixtures. Copy fixtures.example.json to fixtures.local.json.';
