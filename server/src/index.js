// The data service behind the mock draft simulator.
//
// The draft itself runs in the browser: a pick has to land the instant you
// click, and nothing about a draft needs a server round trip. What does need a
// server is reaching two upstream feeds that do not allow a browser to call
// them directly, caching what they return, and joining the two boards in one
// place so the browser never has to guess whether two records name the same
// player.

import express from 'express';
import cors from 'cors';
import { ADP_SOURCES, FORMATS, buildBoard, nearestSize } from './board.js';
import { parseRankings } from './rankings.js';
import { importLeague } from './sleeperLeague.js';
import { draftPicks, draftState, leagueSetup, leagueUsers } from './sleeperDraft.js';

const app = express();
const PORT = Number(process.env.PORT) || 5178;
const DEFAULT_YEAR = Number(process.env.DRAFT_YEAR) || new Date().getFullYear();

// The Vite proxy puts the client on this origin, so a normal run never meets
// CORS at all. It is open here for anyone running the two halves apart.
app.use(cors());

app.use(express.json({ limit: '4mb' }));
app.use(express.text({ limit: '4mb', type: ['text/csv', 'text/plain'] }));

/** A Sleeper league or draft ID is a long run of digits and nothing else. */
const IS_ID = /^\d{6,25}$/;

/**
 * Read an ID out of the path, or answer 400 and return null.
 *
 * Every one of these IDs is pasted into an upstream URL, so it is checked here
 * rather than trusted. Express decodes a path parameter before this sees it,
 * which is what makes the check worth doing: without it an encoded slash walks
 * the upstream path instead of naming a league.
 */
function readId(req, res) {
  const id = String(req.params.id || '').trim();
  if (IS_ID.test(id)) return id;
  res.status(400).json({ error: 'A Sleeper ID is a long run of digits. Check the one you sent.' });
  return null;
}

function readQuery(q) {
  const format = FORMATS[q.scoring] ? q.scoring : 'half-ppr';
  const adpSource = ADP_SOURCES[q.adpSource] ? q.adpSource : 'sleeper';
  const teams = Math.min(16, Math.max(2, Number(q.teams) || 12));
  // A year is a new cache key and a new set of upstream fetches, so an
  // unbounded one lets a stranger drive traffic at two free feeds on our
  // behalf. Neither feed holds a season outside this window.
  const asked = Number(q.year) || DEFAULT_YEAR;
  const year = asked >= 2015 && asked <= DEFAULT_YEAR + 1 ? Math.trunc(asked) : DEFAULT_YEAR;
  return { format, adpSource, teams, year, force: q.force === '1' || q.force === 'true' };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, year: DEFAULT_YEAR, formats: FORMATS, adpSources: ADP_SOURCES });
});

/** The merged draft board for one scoring format and league size. */
app.get('/api/board', async (req, res) => {
  const q = readQuery(req.query);
  try {
    const board = await buildBoard(q);
    res.json(board);
  } catch (err) {
    res.status(502).json({
      error: 'Could not reach the ADP feeds and no cached copy exists.',
      detail: String(err.message || err),
    });
  }
});

/**
 * Match a pasted or uploaded ranking list against that board.
 *
 * `overrides` is the user's own name to player mapping, kept in their browser
 * and sent with every request. It is applied before any automatic tier, so a
 * decision the user made once is never second guessed.
 */
app.post('/api/rankings', async (req, res) => {
  const q = readQuery({ ...req.query, ...(req.is('application/json') ? req.body : {}) });
  const text = typeof req.body === 'string' ? req.body : req.body?.csv;
  const overrides = (req.is('application/json') && req.body?.overrides) || {};
  const rankColumn = req.is('application/json') && req.body?.rankColumn != null
    ? Number(req.body.rankColumn)
    : null;

  if (!text || !String(text).trim()) {
    res.status(400).json({ error: 'Send the ranking list as `csv` in the request body.' });
    return;
  }

  try {
    const board = await buildBoard(q);
    const result = parseRankings(text, board.players, overrides, rankColumn);
    res.json({ ...result, poolSize: board.players.length });
  } catch (err) {
    res.status(502).json({
      error: 'Could not build the board to match your rankings against.',
      detail: String(err.message || err),
    });
  }
});

/** Read a real Sleeper league and return draft settings that match it. */
app.get('/api/sleeper/league/:id', async (req, res) => {
  const id = readId(req, res);
  if (!id) return;
  try {
    res.json(await importLeague(id, req.query.force === '1'));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

/** Who is in a league, so you can say which team is yours. */
app.get('/api/sleeper/league/:id/users', async (req, res) => {
  const id = readId(req, res);
  if (!id) return;
  try {
    res.json(await leagueUsers(id, req.query.force === '1'));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

/**
 * Everything about a real league in one answer: the seats and their team names,
 * the keepers declared so far, and the state of the draft.
 */
app.get('/api/sleeper/league/:id/setup', async (req, res) => {
  const id = readId(req, res);
  if (!id) return;
  try {
    res.json(await leagueSetup(id, readQuery(req.query), req.query.force === '1'));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

/** Whether a draft has opened, and who sits in which slot. */
app.get('/api/sleeper/draft/:id', async (req, res) => {
  const id = readId(req, res);
  if (!id) return;
  try {
    res.json(await draftState(id));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

/**
 * Every pick made in a real draft so far, mapped onto this board.
 * Never cached: a draft in progress is stale the moment it is read.
 */
app.get('/api/sleeper/draft/:id/picks', async (req, res) => {
  const id = readId(req, res);
  if (!id) return;
  try {
    res.set('cache-control', 'no-store');
    res.json(await draftPicks(id, readQuery(req.query)));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

/**
 * The loopback by default, so this answers your own machine and nothing else.
 *
 * The Vite proxy reaches it over the loopback, so a normal run costs nothing
 * for the closed default. Set HOST to `0.0.0.0` when the service has to answer
 * something that is not on this machine, which is what a container needs.
 */
const HOST = process.env.HOST || '127.0.0.1';

app.listen(PORT, HOST, () => {
  console.log(`Mock draft data service listening on http://${HOST}:${PORT}`);
  console.log(`Default season ${DEFAULT_YEAR}. ADP league sizes available: 8, 10, 12, 14.`);
  console.log(`A 12 team request maps to the ${nearestSize(12)} team ADP set.`);
});
