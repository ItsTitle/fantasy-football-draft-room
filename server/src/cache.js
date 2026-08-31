// Disk cache for upstream payloads.
//
// Both upstream sources are free and ask for no key, but both also move once a
// day at most. A cache keeps the tool usable when the network is down and keeps
// us from hammering two services that give their data away.
//
// The cache is bounded in both halves. Anyone can ask this service about any
// league ID, and every distinct ID is a new key, so an unbounded cache is a
// disk and a heap that a stranger decides the size of. Both halves drop the
// entry that was used longest ago.

import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, '..', 'data', 'cache');

/** How many entries to hold in memory. Beyond this the least recent one goes. */
const MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES) || 200;

/** How many files to hold on disk. Beyond this the oldest ones go. */
const MAX_FILES = Number(process.env.CACHE_MAX_FILES) || 500;

/**
 * A Map in insertion order, used as a least recently used list: a read moves
 * its entry to the end, so the first key is always the one to drop.
 */
const memory = new Map();

function remember(key, entry) {
  memory.set(key, entry);
  while (memory.size > MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    memory.delete(oldest);
  }
}

function recall(key) {
  const entry = memory.get(key);
  if (!entry) return null;
  memory.delete(key);
  memory.set(key, entry);
  return entry;
}

let pruning = false;

/**
 * Drop the oldest files once there are too many.
 *
 * This runs after a write and never blocks it. A cache that cannot be tidied
 * is still a working cache, so every failure here is swallowed.
 */
async function prune() {
  if (pruning) return;
  pruning = true;
  try {
    const names = await readdir(CACHE_DIR);
    if (names.length <= MAX_FILES) return;

    const files = await Promise.all(names.map(async (name) => {
      const path = join(CACHE_DIR, name);
      try {
        return { path, at: (await stat(path)).mtimeMs };
      } catch {
        return null;
      }
    }));

    const sorted = files.filter(Boolean).sort((a, b) => a.at - b.at);
    for (const file of sorted.slice(0, sorted.length - MAX_FILES)) {
      await unlink(file.path).catch(() => {});
    }
  } catch {
    // No cache directory yet, or no permission to tidy it. Neither is fatal.
  } finally {
    pruning = false;
  }
}

function safeName(key) {
  return key.replace(/[^a-z0-9._-]/gi, '_') + '.json';
}

/**
 * Return a cached value, or produce it with `fetcher` and store it.
 *
 * A stale entry is better than no entry. If `fetcher` throws and a stale copy
 * exists on disk, the stale copy is returned and marked as such.
 *
 * @param {string} key         cache file name, without the extension
 * @param {number} maxAgeMs    how long a fresh entry stays fresh
 * @param {() => Promise<any>} fetcher
 * @param {boolean} force      ignore the cached copy and re-fetch
 */
export async function cached(key, maxAgeMs, fetcher, force = false) {
  const file = join(CACHE_DIR, safeName(key));
  const now = Date.now();

  if (!force) {
    const hot = recall(key);
    if (hot && now - hot.fetchedAt < maxAgeMs) return hot;

    try {
      const disk = JSON.parse(await readFile(file, 'utf8'));
      if (now - disk.fetchedAt < maxAgeMs) {
        remember(key, disk);
        return disk;
      }
    } catch {
      // No usable copy on disk. Fall through to the fetch.
    }
  }

  try {
    const entry = { key, fetchedAt: now, stale: false, value: await fetcher() };
    remember(key, entry);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(entry), 'utf8');
    void prune();
    return entry;
  } catch (err) {
    try {
      const disk = JSON.parse(await readFile(file, 'utf8'));
      disk.stale = true;
      disk.error = String(err.message || err);
      remember(key, disk);
      return disk;
    } catch {
      throw err;
    }
  }
}
