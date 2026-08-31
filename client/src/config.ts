/**
 * What this copy of the app knows before you tell it anything.
 *
 * Your Sleeper leagues and your Sleeper name belong to you, not to the
 * program, so they are read from the environment at build time instead of
 * being written into the source. A fresh checkout starts with no leagues and
 * no manager, and asks for a league ID like it does for everybody else.
 *
 * Set them in `client/.env.local`, which git ignores:
 *
 *   VITE_SEED_LEAGUES=[{"id":"1234567890123456789","name":"My League"}]
 *   VITE_DEFAULT_MANAGER=YourSleeperName
 *
 * `client/.env.example` holds the same two lines with nothing real in them.
 *
 * A league ID identifies real people: it is enough to look the league up and
 * read every manager in it. That is the reason these two settings live here
 * and not in `storage.ts`, and the reason the app has an anonymity toggle at
 * all. See `anon.ts`.
 */

/** A league this copy starts out knowing about. */
export interface SeedLeague {
  id: string;
  name: string;
}

/** A Sleeper ID is a long run of digits. Anything else is a typo, not an ID. */
const IS_ID = /^\d{6,25}$/;

/**
 * Read the seed leagues, and drop anything malformed rather than fail to load.
 *
 * A bad value here must not stop the app. The setting is a convenience, and an
 * app that refuses to start because one character of JSON is wrong is worse
 * than an app that starts with an empty league list and says why.
 */
function readSeedLeagues(raw: string | undefined): SeedLeague[] {
  if (!raw || !raw.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('VITE_SEED_LEAGUES is not valid JSON. No leagues were seeded.');
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.warn('VITE_SEED_LEAGUES must be a JSON array. No leagues were seeded.');
    return [];
  }

  const out: SeedLeague[] = [];
  for (const item of parsed) {
    const entry = item as Partial<SeedLeague> | null;
    const id = String(entry?.id ?? '').trim();
    if (!IS_ID.test(id)) {
      console.warn('VITE_SEED_LEAGUES skipped an entry with no usable league ID.');
      continue;
    }
    const name = String(entry?.name ?? '').trim();
    out.push({ id, name: name || 'Sleeper league' });
  }
  return out;
}

function readManager(raw: string | undefined): string | null {
  const name = (raw || '').trim();
  return name || null;
}

/** The leagues this copy ships knowing about. Empty unless you set them. */
export const SEED_LEAGUES: SeedLeague[] = readSeedLeagues(import.meta.env.VITE_SEED_LEAGUES);

/**
 * The Sleeper name this copy assumes is you until you say otherwise.
 *
 * Null is the ordinary case. Your seat is then chosen from the league's own
 * member list, which is what the "Which manager are you" control is for.
 */
export const DEFAULT_MANAGER: string | null = readManager(import.meta.env.VITE_DEFAULT_MANAGER);
