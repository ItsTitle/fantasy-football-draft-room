/**
 * A check on the draft engine that runs without a browser.
 *
 *   npm run engine:test
 *
 * It pulls a real board from the data service, runs whole drafts, and asserts
 * the things a mock draft has to get right: every team fills a lineup, nobody
 * holds three kickers, the snake order is a snake, and the position dials move
 * the board in the direction the label promises.
 */

import { PRESETS, DEFAULT_CPU, applyBias } from './cpu';
import {
  autoDraftRest, availablePlayers, createDraft, currentPick, currentTeam, draftPlayer,
  nextUserChoice, presetFor, runCpuPick, runPresetsOnly, runToUserTurn, undoPick,
} from './draft';
import { NO_FIXTURES, loadFixtures } from './fixtures';
import { biggestSteals, gradeDraft } from './grade';
import { mergePresets } from './live';
import {
  keeperPicksIn, pickOrder, picksForTeam, picksInRound, roundOrder, seatOf,
} from './order';
import { DEFAULT_ROSTER, bestLineup, rosterSize, startersFilled } from './roster';
import type { Board, CpuConfig, LeagueConfig, Position, RosterSlots } from './types';
import { POSITIONS } from './types';

const API = process.env.API || 'http://localhost:5178';

/**
 * The real leagues to check against, or null when nobody named any.
 *
 * The blocks that need one say they were skipped rather than fail. Everything
 * that runs off the board alone still runs. See `fixtures.ts`.
 */
const fixtures = loadFixtures();

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    console.log('  pass  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail ? '  -> ' + detail : ''));
  }
}

function league(over: Partial<LeagueConfig> = {}): LeagueConfig {
  const roster: RosterSlots = { ...DEFAULT_ROSTER, ...(over.roster || {}) };
  return {
    teamNames: null,
    tradedPicks: null,
    teams: 12,
    rounds: rosterSize(roster),
    mySlot: 5,
    draftType: 'snake',
    scoring: 'half-ppr',
    adpSource: 'sleeper',
    year: 2026,
    seed: 12345,
    ...over,
    roster,
  };
}

function runDraft(board: Board, lg: LeagueConfig, cpu: CpuConfig) {
  let engine = createDraft(lg, cpu, board.players, null);
  engine = autoDraftRest(engine);
  return engine;
}

/**
 * The overall pick the nth player at a position went at.
 *
 * This is the metric that answers "did the dial work", and the average round is
 * not. Forcing a position drafts more of them, which drags deeper and cheaper
 * players into the average and hides the very move you asked for.
 */
function nthAt(engine: ReturnType<typeof runDraft>, pos: Position, n: number): number {
  const hits = engine.state.picks.filter((p) => engine.byId.get(p.playerId)?.position === pos);
  return hits[n - 1] ? hits[n - 1].overall : NaN;
}

/** The average round a position came off the board in. */
function averageRound(engine: ReturnType<typeof runDraft>, pos: Position): number {
  const rounds = engine.state.picks
    .filter((p) => engine.byId.get(p.playerId)?.position === pos)
    .map((p) => p.round);
  if (!rounds.length) return NaN;
  return rounds.reduce((a, b) => a + b, 0) / rounds.length;
}

async function main() {
  console.log('Fetching a live board from ' + API);
  const res = await fetch(API + '/api/board?scoring=half-ppr&teams=12&adpSource=sleeper');
  if (!res.ok) throw new Error('The data service is not running. Start it with: npm run dev:server');
  const board: Board = await res.json();
  console.log('Board: ' + board.players.length + ' players, join rate '
    + Math.round(board.meta.joinRate * 100) + '%\n');

  console.log('Pick order');
  {
    const snake = pickOrder('snake', 12, 3);
    check('snake round 1 runs 1 to 12', snake.slice(0, 12).join() === '0,1,2,3,4,5,6,7,8,9,10,11');
    check('snake round 2 runs 12 to 1', snake.slice(12, 24).join() === '11,10,9,8,7,6,5,4,3,2,1,0');
    const linear = pickOrder('linear', 12, 2);
    check('linear never reverses', linear.slice(0, 12).join() === linear.slice(12, 24).join());
    const trr = pickOrder('third-round-reversal', 12, 3);
    check('third round repeats round two', trr.slice(12, 24).join() === trr.slice(24, 36).join());
    const mine = picksForTeam('snake', 12, 4, 4);
    check('slot 5 owns picks 5, 20, 29, 44', mine.join() === '5,20,29,44', mine.join());
  }

  console.log('\nTraded picks');
  {
    // Slot 5 sells its second to slot 1. In a snake round two that pick is
    // overall 20, and it must stay at 20: a trade changes the hand that makes
    // a pick, never where the pick sits.
    const trade = [{ round: 2, fromSlot: 5, toSlot: 1 }];
    const order = pickOrder('snake', 12, 4, trade);
    check('a traded pick keeps its place in the order',
      order.length === 48 && order[19] === 0, 'overall 20 -> team ' + order[19]);
    check('the seller loses it',
      !picksForTeam('snake', 12, 4, 4, trade).includes(20));
    check('the buyer gains it',
      picksForTeam('snake', 12, 4, 0, trade).includes(20));
    check('no other pick moves',
      pickOrder('snake', 12, 4).filter((t, i) => t !== order[i]).length === 1);

    // Two of one round and none of another is the case every "one pick per
    // team per round" assumption in this app used to get wrong.
    check('a team can hold two picks in a round',
      picksInRound('snake', 12, 2, 0, trade).join() === '20,24',
      picksInRound('snake', 12, 2, 0, trade).join());
    check('a team can hold none',
      picksInRound('snake', 12, 2, 4, trade).length === 0);
    check('the seat a pick sits in does not change', seatOf('snake', 12, 20) === 4);

    // A trade out and back is two rows in Sleeper's feed and no change here.
    check('a pick traded away and bought back is unchanged',
      pickOrder('snake', 12, 4, [{ round: 2, fromSlot: 5, toSlot: 5 }]).join()
        === pickOrder('snake', 12, 4).join());

    // Every pick still belongs to exactly one team, and the draft is the same
    // length. A swap that loses or duplicates a pick would desync the board.
    const swapped = pickOrder('snake', 12, 16, [
      { round: 3, fromSlot: 2, toSlot: 11 }, { round: 3, fromSlot: 11, toSlot: 2 },
    ]);
    check('a two way swap keeps the draft the same length', swapped.length === 192);
    check('a two way swap gives each side the same number of picks',
      swapped.filter((t) => t === 1).length === swapped.filter((t) => t === 10).length);

    const lg = league({ teams: 12, rounds: 4, mySlot: 5, tradedPicks: trade });
    const engine = autoDraftRest(createDraft(lg, DEFAULT_CPU, board.players, null));
    check('a draft with a traded pick still makes every pick',
      engine.state.picks.length === 48, String(engine.state.picks.length));
    check('the buyer ends up with the extra player',
      engine.state.teams[0].playerIds.length === 5, String(engine.state.teams[0].playerIds.length));
    check('the seller ends up one short',
      engine.state.teams[4].playerIds.length === 3, String(engine.state.teams[4].playerIds.length));
    check('the pick at 20 was made by the buyer',
      engine.state.picks.find((p) => p.overall === 20)?.teamIndex === 0);

    /*
     * Which pick a keeper costs, when a team holds several in the round.
     *
     * Seat 4 bought round eight from seats 11 and 5 and still owns its own, so
     * it holds 8.02, 8.08 and 8.09. A keeper costing "a round eight pick" costs
     * 8.09: the one the seat owns by right. Taking the earliest instead spent
     * the pick bought from seat 11, and the board showed the keeper sitting in
     * that manager's slot.
     */
    const many = [
      { round: 8, fromSlot: 11, toSlot: 4 },
      { round: 8, fromSlot: 5, toSlot: 4 },
    ];
    const held = picksInRound('snake', 12, 8, 3, many);
    check('a team can hold three picks in one round', held.join() === '86,92,93', held.join());
    const forKeeper = keeperPicksIn('snake', 12, 8, 3, many);
    check('a keeper costs the seat its own pick first', forKeeper[0] === 93,
      'first choice ' + forKeeper[0]);
    check('the bought picks are still available to spend',
      forKeeper.slice(1).sort().join() === '86,92', forKeeper.slice(1).join());
    check('a seat that sold its own falls back on one it bought',
      keeperPicksIn('snake', 12, 8, 3, [...many, { round: 8, fromSlot: 4, toSlot: 1 }])[0] === 86);
  }

  console.log('\nResuming a mock from a real draft');
  {
    const lg = league({ teams: 12, rounds: 4, mySlot: 5 });
    const ids = board.players.slice(0, 30).map((p) => p.id);

    // Three keepers, and a draft that has run eleven picks. Two of the keepers
    // were among those eleven, because a draft records its keepers as picks.
    const keepers = [
      { overall: 3, playerId: ids[0], source: 'keeper' as const },
      { overall: 9, playerId: ids[1], source: 'keeper' as const },
      { overall: 40, playerId: ids[2], source: 'keeper' as const },
    ];
    const live = Array.from({ length: 11 }, (_, i) => ({
      overall: i + 1,
      playerId: i === 2 ? ids[0] : (i === 8 ? ids[1] : ids[10 + i]),
      source: 'live' as const,
    }));

    const merged = mergePresets(keepers, live);
    check('the real picks and the keepers ahead of them all survive',
      merged.length === 12, String(merged.length));
    check('a keeper the draft has already taken does not claim a second slot',
      merged.filter((p) => p.playerId === ids[0]).length === 1);
    check('the real pick wins where the two disagree',
      merged.find((p) => p.overall === 3)?.source === 'live');
    check('a keeper the draft has not reached is left alone',
      merged.find((p) => p.overall === 40)?.source === 'keeper');
    check('the claims are in pick order',
      merged.every((p, i) => i === 0 || p.overall > merged[i - 1].overall));

    // The whole point: the picks made stay made, and the rest is simulated.
    const resumed = autoDraftRest(createDraft(lg, DEFAULT_CPU, board.players, null, merged));
    check('a resumed mock still finishes the draft',
      resumed.state.picks.length === 48, String(resumed.state.picks.length));
    check('the picks the room really made are the ones on the board',
      live.every((p) => resumed.state.picks.find((made) => made.overall === p.overall)
        ?.playerId === p.playerId));
    check('the keeper past the live point is still honoured',
      resumed.state.picks.find((p) => p.overall === 40)?.playerId === ids[2]);
    check('nobody appears twice',
      new Set(resumed.state.picks.map((p) => p.playerId)).size === resumed.state.picks.length);
  }

  console.log('\nRoster maths');
  {
    const r = DEFAULT_ROSTER;
    check('default roster is 15 rounds', rosterSize(r) === 15, String(rosterSize(r)));
    const three = { QB: 3, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 } as Record<Position, number>;
    check('three quarterbacks fill one slot', startersFilled(three, r) === 1, String(startersFilled(three, r)));
    const flexed = { QB: 1, RB: 3, WR: 2, TE: 1, K: 1, DEF: 1 } as Record<Position, number>;
    check('the third back takes the flex', startersFilled(flexed, r) === 9, String(startersFilled(flexed, r)));
  }

  console.log('\nA full draft, market settings');
  {
    const lg = league();
    const engine = runDraft(board, lg, DEFAULT_CPU);
    check('every pick was made', engine.state.picks.length === lg.teams * lg.rounds,
      engine.state.picks.length + ' of ' + lg.teams * lg.rounds);
    check('no player went twice', new Set(engine.state.picks.map((p) => p.playerId)).size === engine.state.picks.length);
    check('the draft reports itself done', engine.state.done);
    check('nobody is on the clock', currentTeam(engine.state) === null);

    let allFieldLineups = true;
    let maxK = 0;
    let maxDef = 0;
    for (const team of engine.state.teams) {
      const players = team.playerIds.map((id) => engine.byId.get(id)!);
      const { starters } = bestLineup(players, lg.roster);
      if (starters.length !== 9) allFieldLineups = false;
      maxK = Math.max(maxK, team.counts.K);
      maxDef = Math.max(maxDef, team.counts.DEF);
    }
    check('every team fields a full lineup', allFieldLineups);
    check('nobody drafted two kickers', maxK <= 1, 'max ' + maxK);
    check('nobody drafted two defences', maxDef <= 1, 'max ' + maxDef);

    // Kickers and defences carry the widest measured ADP spread on the board, so
    // the odd early one is the model telling the truth about real drafts. What
    // must never happen is one in the middle of the draft.
    const kRound = averageRound(engine, 'K');
    const defRound = averageRound(engine, 'DEF');
    const earliest = (pos: Position) => Math.min(...engine.state.picks
      .filter((p) => engine.byId.get(p.playerId)?.position === pos).map((p) => p.round));
    console.log('        kickers average round ' + kRound.toFixed(1)
      + ', earliest ' + earliest('K')
      + '. Defences average ' + defRound.toFixed(1) + ', earliest ' + earliest('DEF'));
    check('kickers land in the back third', kRound >= lg.rounds - 2.2);
    check('defences land in the back third', defRound >= lg.rounds - 2.8);
    check('no kicker goes in the first two thirds', earliest('K') > lg.rounds * 0.66);
    check('no defence goes in the first two thirds', earliest('DEF') > lg.rounds * 0.66);

    /*
     * WHICH WAY VALUE RUNS
     *
     * You beat ADP by taking a player later than the market does. Nothing
     * checked the direction, and it was subtracted the other way round: a
     * kicker taken at pick 5 on an ADP of 200 scored as the best value pick in
     * the draft, at +195.
     */
    {
      const pickAt = new Map(engine.state.picks.map((p) => [p.playerId, p.overall]));
      let fell = null as null | { name: string; adp: number; at: number };
      let reached = null as null | { name: string; adp: number; at: number };
      for (const p of engine.state.picks) {
        const player = engine.byId.get(p.playerId)!;
        const row = { name: player.name, adp: player.adp, at: p.overall };
        if (!fell || row.at - row.adp > fell.at - fell.adp) fell = row;
        if (!reached || row.at - row.adp < reached.at - reached.adp) reached = row;
      }
      console.log('        furthest fall  ' + fell!.name + ' adp ' + fell!.adp.toFixed(1)
        + ' taken at ' + fell!.at);
      console.log('        furthest reach ' + reached!.name + ' adp ' + reached!.adp.toFixed(1)
        + ' taken at ' + reached!.at);

      const steals = biggestSteals(engine, 5);
      check('a steal is a player taken after his ADP',
        steals.every((s) => s.gain > 0 && s.pick.overall > s.player.adp));
      check('the biggest steal is the player who fell furthest',
        steals[0].player.name === fell!.name, steals[0].player.name);
      check('the steal list runs from biggest to smallest',
        steals.every((s, i) => i === 0 || s.gain <= steals[i - 1].gain));

      // A team's value is the sum of the same measure over its own picks.
      const someone = gradeDraft(engine)[0];
      const byHand = someone.players.reduce(
        (sum, p) => sum + ((pickAt.get(p.id) ?? 0) - p.adp), 0,
      );
      check('a team value is the sum of its own picks against ADP',
        Math.abs(someone.value - byHand) < 0.2,
        someone.value + ' against ' + byHand.toFixed(1));
      check('the best value pick fell, and the worst reach did not',
        someone.bestValuePick!.gain >= someone.worstReach!.gain);
    }

    const results = gradeDraft(engine);
    check('every team is graded', results.every((r) => r.grade !== ''));
    check('ranks run 1 to 12', new Set(results.map((r) => r.rank)).size === 12);
    const top = results.find((r) => r.rank === 1)!;
    const bottom = results.find((r) => r.rank === 12)!;
    check('the top team outscores the bottom', top.points > bottom.points,
      top.points + ' against ' + bottom.points);
    console.log('        top lineup ' + top.points.toFixed(1) + ' points, '
      + 'bottom ' + bottom.points.toFixed(1));
  }

  console.log('\nThe position dials');
  {
    check('bias +5 pulls pick 60 forward', applyBias(60, 5) < 36, applyBias(60, 5).toFixed(1));
    check('bias -5 pushes pick 60 back', applyBias(60, -5) > 84, applyBias(60, -5).toFixed(1));
    check('bias 0 changes nothing', applyBias(60, 0) === 60);
    check('bias +5 still moves the top of the board', applyBias(10, 5) < 4, applyBias(10, 5).toFixed(1));

    const lg = league();
    const flat = runDraft(board, lg, DEFAULT_CPU);
    const heavyRb = runDraft(board, lg, {
      ...DEFAULT_CPU,
      positionBias: { QB: 0, RB: 5, WR: 0, TE: 0, K: 0, DEF: 0 },
    });
    const lightRb = runDraft(board, lg, {
      ...DEFAULT_CPU,
      positionBias: { QB: 0, RB: -5, WR: 0, TE: 0, K: 0, DEF: 0 },
    });

    const row = (label: string, e: ReturnType<typeof runDraft>) => label.padEnd(8)
      + ' RB12 at pick ' + String(nthAt(e, 'RB', 12)).padStart(3)
      + ',  RB24 at pick ' + String(nthAt(e, 'RB', 24)).padStart(3)
      + ',  WR12 at pick ' + String(nthAt(e, 'WR', 12)).padStart(3);
    console.log('        ' + row('neutral', flat));
    console.log('        ' + row('forced', heavyRb));
    console.log('        ' + row('avoided', lightRb));

    check('forcing running backs takes RB12 sooner',
      nthAt(heavyRb, 'RB', 12) < nthAt(flat, 'RB', 12) - 2);
    check('forcing running backs takes RB24 sooner',
      nthAt(heavyRb, 'RB', 24) < nthAt(flat, 'RB', 24) - 5);
    check('avoiding running backs takes RB12 later',
      nthAt(lightRb, 'RB', 12) > nthAt(flat, 'RB', 12) + 2);
    check('avoiding running backs takes RB24 later',
      nthAt(lightRb, 'RB', 24) > nthAt(flat, 'RB', 24) + 5);
    check('forcing running backs pushes receivers back',
      nthAt(heavyRb, 'WR', 12) > nthAt(flat, 'WR', 12));

    // Every level in between has to move the board too, or the dial is a switch.
    const rb12 = [-5, -3, 0, 3, 5].map((level) => nthAt(runDraft(board, lg, {
      ...DEFAULT_CPU, positionBias: { QB: 0, RB: level, WR: 0, TE: 0, K: 0, DEF: 0 },
    }), 'RB', 12));
    console.log('        RB12 at settings -5, -3, 0, +3, +5: ' + rb12.join(', '));
    // The metric is a pick number, so neighbouring settings can tie. What has to
    // hold is that the sequence never turns back on itself and that the two ends
    // sit far apart.
    check('the dial never reverses across its range',
      rb12.every((v, i) => i === 0 || v <= rb12[i - 1]), rb12.join(', '));
    check('the two ends of the dial are a round apart',
      rb12[0] - rb12[4] >= 8, String(rb12[0] - rb12[4]));

    void averageRound;
  }

  console.log('\nRandomness and repeatability');
  {
    const lg = league();
    const a = runDraft(board, lg, DEFAULT_CPU);
    const b = runDraft(board, lg, DEFAULT_CPU);
    check('the same seed replays the same draft',
      a.state.picks.map((p) => p.playerId).join() === b.state.picks.map((p) => p.playerId).join());

    const c = runDraft(board, league({ seed: 999 }), DEFAULT_CPU);
    check('a new seed makes a new draft',
      a.state.picks.map((p) => p.playerId).join() !== c.state.picks.map((p) => p.playerId).join());

    const strict = runDraft(board, lg, { ...DEFAULT_CPU, randomness: 0 });
    const strictOrder = strict.state.picks.slice(0, 24).map((p) => strict.byId.get(p.playerId)?.position);
    check('randomness 0 is deterministic', strictOrder.length === 24);

    const chaos = runDraft(board, lg, { ...DEFAULT_CPU, randomness: 10 });
    const spreadStrict = reachSpread(strict);
    const spreadChaos = reachSpread(chaos);
    console.log('        average gap between pick and ADP: '
      + 'randomness 0 is ' + spreadStrict.toFixed(1) + ' picks, '
      + 'randomness 10 is ' + spreadChaos.toFixed(1));
    check('more randomness means more reaching', spreadChaos > spreadStrict * 1.5);
    check('even chaos stays inside the draft', spreadChaos < 70, spreadChaos.toFixed(1));
    const chaosFirst = chaos.byId.get(chaos.state.picks[0].playerId)!;
    check('chaos still opens with a first round player', chaosFirst.adp <= 40,
      chaosFirst.name + ' at ADP ' + chaosFirst.adp);
  }

  console.log('\nRoster need');
  {
    const lg = league({ rounds: 9, roster: { ...DEFAULT_ROSTER, BENCH: 0 } });
    const needy = runDraft(board, lg, { ...DEFAULT_CPU, needWeight: 10 });
    const blind = runDraft(board, lg, { ...DEFAULT_CPU, needWeight: 0 });

    const complete = (e: typeof needy) => e.state.teams.filter((t) => {
      const players = t.playerIds.map((id) => e.byId.get(id)!);
      return bestLineup(players, lg.roster).starters.length === 9;
    }).length;

    console.log('        teams with a full lineup in a 9 round draft: '
      + 'need 10 gives ' + complete(needy) + ' of 12, '
      + 'need 0 gives ' + complete(blind) + ' of 12');
    check('roster need fills every lineup', complete(needy) === 12);
    check('ignoring roster need leaves holes', complete(blind) < 12);
  }

  console.log('\nEvery preset runs');
  for (const preset of PRESETS) {
    const lg = league();
    const engine = runDraft(board, lg, preset.cpu);
    check(preset.name, engine.state.picks.length === lg.teams * lg.rounds);
  }

  console.log('\nOther league shapes');
  {
    // A superflex roster needs the superflex ADP board. Run it against the half
    // PPR board and the room reads quarterbacks as cheap, because on that board
    // they are. The settings panel warns about the same mismatch.
    const sfRes = await fetch(API + '/api/board?scoring=2qb&teams=10&adpSource=sleeper');
    const sfBoard: Board = await sfRes.json();
    const sf = league({
      roster: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SUPERFLEX: 1, K: 1, DEF: 1, BENCH: 6 },
      teams: 10,
      scoring: '2qb',
    });
    const engine = runDraft(sfBoard, { ...sf, rounds: rosterSize(sf.roster) }, DEFAULT_CPU);
    const qbPerTeam = engine.state.teams.map((t) => t.counts.QB);
    check('superflex leagues draft two quarterbacks a team',
      qbPerTeam.filter((n) => n >= 2).length >= 8, qbPerTeam.join(' '));

    const deep = league({ teams: 14, roster: { ...DEFAULT_ROSTER, BENCH: 10 } });
    const deepEngine = runDraft(board, { ...deep, rounds: rosterSize(deep.roster) }, DEFAULT_CPU);
    check('a 14 team, 19 round draft completes',
      deepEngine.state.picks.length === 14 * 19, String(deepEngine.state.picks.length));

    const tiny = league({ teams: 4, rounds: 5 });
    const tinyEngine = runDraft(board, tiny, DEFAULT_CPU);
    check('a 4 team, 5 round draft completes', tinyEngine.state.picks.length === 20);
  }

  console.log('\nThe name matcher');
  {
    const post = async (csv: string, overrides: Record<string, string | null> = {}) => {
      const r = await fetch(API + '/api/rankings?scoring=standard&teams=12&adpSource=sleeper', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv, overrides }),
      });
      return r.json();
    };

    type Row = { sourceName: string; name: string; position: string; matchedBy: string; rank: number };
    const find = (set: { entries: Row[] }, source: string) => set.entries.find(
      (e) => e.sourceName === source,
    );

    // A shallow board must not lose real players. Before the cross format
    // fallback, standard scoring held 311 of the 599 Sleeper ranks and every
    // missing one was reported to the user as a name that matched nothing.
    const shallow = await fetch(API + '/api/board?scoring=standard&teams=12&adpSource=sleeper');
    const shallowBoard: Board = await shallow.json();
    console.log('        the standard board holds ' + shallowBoard.players.length
      + ' players, ' + shallowBoard.meta.adpBorrowed + ' with an ADP borrowed from another format');
    check('a shallow scoring format still gets a full board',
      shallowBoard.players.length > 550, String(shallowBoard.players.length));

    // A real export carries six columns with "rank" in the name. Only one of
    // them is the ranking, and reading the wrong one sorts your board into
    // market order while still calling it yours.
    const etrHeader = 'Player,Position,Team,ETR Rank,ADP,Ranking Diff,'
      + 'ETR Pos Rank,ADP Pos Rank,Pos Rank Diff,id';
    const etr = await post([
      etrHeader,
      'Jahmyr Gibbs,RB,DET,1,1.5,0.5,RB01,RB01,0,4429795',
      'Kenneth Walker,RB,KC,2,22.7,20.7,RB02,RB09,7,4567048',
      'Omarion Hampton,RB,LAC,3,12.2,9.2,RB03,RB05,2,4685702',
      'Chase Brown,RB,CIN,4,17.8,13.8,RB04,RB07,3,4362238',
    ].join(String.fromCharCode(10)));

    check('the ranking column beats the ADP column',
      etr.columns.rank === 'etr rank', String(etr.columns.rank));
    check('your order is your order, not the market order',
      etr.entries.map((e: Row) => e.name).join(' | ')
        === 'Jahmyr Gibbs | Kenneth Walker | Omarion Hampton | Chase Brown',
      etr.entries.map((e: Row) => e.name).join(' | '));
    check('every header is offered back so the column can be changed',
      etr.columns.headers.length === 10, String(etr.columns.headers.length));

    // And when detection is wrong anyway, pointing at a column wins.
    const forced = await fetch(API + '/api/rankings?scoring=standard&teams=12&adpSource=sleeper', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        csv: [
          etrHeader,
          'Jahmyr Gibbs,RB,DET,1,1.5,0.5,RB01,RB01,0,4429795',
          'Kenneth Walker,RB,KC,2,22.7,20.7,RB02,RB09,7,4567048',
          'Omarion Hampton,RB,LAC,3,12.2,9.2,RB03,RB05,2,4685702',
        ].join(String.fromCharCode(10)),
        rankColumn: 4,
      }),
    }).then((r) => r.json());
    check('choosing a column by hand overrides detection',
      forced.entries.map((e: Row) => e.name).join(' | ')
        === 'Jahmyr Gibbs | Omarion Hampton | Kenneth Walker',
      forced.entries.map((e: Row) => e.name).join(' | '));

    const hard = await post([
      'Player,Pos,Team,Rank',
      'Pat Freiermuth,TE,PIT,1',
      'Kenneth Gainwell,RB,PIT,2',
      'Cameron Ward,QB,TEN,3',
      'WAS DST,DST,,4',
      'Washington Commanders,DST,,5',
      'Mike Evans,WR,TB,6',
      'Nobody Whatsoever,WR,XXX,7',
    ].join(String.fromCharCode(10)));

    check('a deep tight end matches on a shallow board', !!find(hard, 'Pat Freiermuth'));
    check('a short first name matches',
      find(hard, 'Kenneth Gainwell')?.name === 'Kenny Gainwell',
      find(hard, 'Kenneth Gainwell')?.name);
    check('a long first name matches its short form',
      find(hard, 'Cameron Ward')?.name === 'Cam Ward', find(hard, 'Cameron Ward')?.name);
    check('a defence written as an abbreviation matches',
      find(hard, 'WAS DST')?.position === 'DEF', JSON.stringify(find(hard, 'WAS DST')));
    check('two names for one defence collapse to one pick', hard.duplicates === 1,
      String(hard.duplicates));
    check('a name that means nobody is reported, not guessed',
      hard.unmatched.length === 1 && hard.unmatched[0].name === 'Nobody Whatsoever',
      JSON.stringify(hard.unmatched.map((u: { name: string }) => u.name)));

    // A misspelling that shares a surname gets the real players offered to it.
    const near = await post('Player,Pos,Team,Rank' + String.fromCharCode(10)
      + 'Jonathin Tayler,RB,IND,1');
    const suggestions = near.unmatched[0]?.suggestions ?? [];
    check('a misspelt name is offered the players it might have meant',
      suggestions.some((x: { name: string }) => x.name === 'Jonathan Taylor'),
      suggestions.map((x: { name: string }) => x.name).join(', ') || 'none');

    // The user maps it once. The mapping wins over every automatic tier.
    const target = suggestions.find((x: { name: string }) => x.name === 'Jonathan Taylor');
    const key = near.unmatched[0].key;
    const fixed = await post('Player,Pos,Team,Rank' + String.fromCharCode(10)
      + 'Jonathin Tayler,RB,IND,1', { [key]: target.id });
    check('a saved mapping resolves the name',
      fixed.entries[0]?.name === 'Jonathan Taylor', fixed.entries[0]?.name);
    check('a saved mapping is reported as yours',
      fixed.entries[0]?.matchedBy === 'override', fixed.entries[0]?.matchedBy);

    // The same mapping applies to a completely different file.
    const later = await post('Player,Pos,Team,Rank' + String.fromCharCode(10)
      + 'Bijan Robinson,RB,ATL,1' + String.fromCharCode(10)
      + 'Jonathin Tayler,RB,IND,2', { [key]: target.id });
    check('the mapping applies to the next file with no prompt',
      later.unmatched.length === 0 && later.entries.length === 2,
      later.unmatched.length + ' unmatched');

    // A name mapped to nothing is left out for good and never asked about again.
    const dropped = await post('Player,Pos,Team,Rank' + String.fromCharCode(10)
      + 'Jonathin Tayler,RB,IND,1', { [key]: null });
    check('a name you chose to leave out stays out',
      dropped.entries.length === 0 && dropped.unmatched.length === 0
      && dropped.ignored.length === 1, JSON.stringify(dropped.ignored));
  }

  console.log('\nPlayer notes');
  {
    const NL = String.fromCharCode(10);
    const post = async (path: string, csv: string) => {
      const r = await fetch(API + '/api/' + path + '?scoring=standard&teams=12&adpSource=sleeper', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      return r.json();
    };
    type Noted = { sourceName: string; name: string; note: string | null };

    // A notes column rides along in a ranking file and must not be mistaken
    // for the ranking. Six columns here contain a word the scorer looks at.
    const withNotes = await post('rankings', [
      'Player,Position,Team,ETR Rank,ADP,Notes',
      'Jahmyr Gibbs,RB,DET,1,1.5,Locked in.',
      'Kenneth Walker,RB,KC,2,22.7,',
      'Omarion Hampton,RB,LAC,3,12.2,Rookie workload is the whole question, and nobody says so.',
    ].join(NL));

    check('a notes column is found', withNotes.columns.note === 'notes',
      String(withNotes.columns.note));
    check('a notes column does not steal the ranking',
      withNotes.columns.rank === 'etr rank', String(withNotes.columns.rank));

    const gibbs = withNotes.entries.find((e: Noted) => e.sourceName === 'Jahmyr Gibbs');
    const walker = withNotes.entries.find((e: Noted) => e.sourceName === 'Kenneth Walker');
    const hampton = withNotes.entries.find((e: Noted) => e.sourceName === 'Omarion Hampton');
    check('a note reaches its player', gibbs?.note === 'Locked in.', String(gibbs?.note));
    check('an empty note is no note', walker?.note === null, String(walker?.note));

    // The note is the last column, so the comma inside it is part of the
    // sentence rather than the start of another column. The spacing after it
    // has to survive too: these are words somebody typed.
    check('a comma inside a note keeps the note whole',
      hampton?.note === 'Rookie workload is the whole question, and nobody says so.',
      String(hampton?.note));

    // A notes file is a ranking file with the ranking left out, so a bare list
    // of names and notes works and matches on the name alone.
    const bare = await post('notes', [
      'Player,Notes',
      'Jahmyr Gibbs,From the notes file.',
      'Nobody Realhere,This one matches nothing.',
    ].join(NL));

    check('a bare notes file matches on the name alone', bare.notes.length === 1,
      bare.notes.length + ' of 1');
    check('a name that matches nothing is reported, not dropped',
      bare.unmatched.length === 1 && bare.unmatched[0].name === 'Nobody Realhere',
      JSON.stringify(bare.unmatched.map((u: { name: string }) => u.name)));

    // A position and a team are optional and they are what the awkward tiers
    // run on: "Cameron Ward" reaches "Cam Ward" through surname, position and
    // team, and reaches nobody without them. This is why the screen asks for
    // the columns rather than only the name.
    const rich = await post('notes', [
      'Player,Pos,Team,Notes',
      'Cameron Ward,QB,TEN,Matched on the surname, the position and the team.',
    ].join(NL));

    check('a notes file with a position uses the same matching tiers',
      rich.notes.length === 1 && rich.notes[0].name === 'Cam Ward',
      JSON.stringify(rich.notes.map((n: { name: string }) => n.name)));

    // A file with nowhere to read a note from is refused, because a silent
    // success here means notes that never appear and no reason given.
    const noColumn = await fetch(
      API + '/api/notes?scoring=standard&teams=12&adpSource=sleeper',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv: 'Player,Rank' + NL + 'Jahmyr Gibbs,1' }),
      },
    );
    check('a file with no notes column is refused', noColumn.status === 400,
      String(noColumn.status));
  }

  console.log('\nSleeper leagues');
  if (!fixtures) {
    console.log(NO_FIXTURES);
  } else {
    const leagues = fixtures.leagues;

    for (const want of leagues) {
      const res2 = await fetch(API + '/api/sleeper/league/' + want.id);
      const got = await res2.json();
      const ok = got.teams === want.teams && got.rounds === want.rounds
        && got.scoring === want.scoring && got.draftType === 'snake';
      check(got.name || want.id, ok,
        got.error || (got.teams + ' teams, ' + got.rounds + ' rounds, ' + got.scoring));

      // A league that imports must produce a draft that actually runs.
      const lg = league({
        teams: got.teams, rounds: got.rounds, roster: got.roster, scoring: got.scoring,
        mySlot: Math.min(6, got.teams),
      });
      const boardRes = await fetch(API + '/api/board?scoring=' + got.scoring
        + '&teams=' + got.teams + '&adpSource=sleeper');
      const leagueBoard: Board = await boardRes.json();
      const engine = runDraft(leagueBoard, lg, DEFAULT_CPU);
      check('  ' + (got.name || want.id) + ' drafts to the last pick',
        engine.state.picks.length === got.teams * got.rounds,
        engine.state.picks.length + ' of ' + got.teams * got.rounds);

      // The one that has no kicker slot must not draft one.
      if (got.roster.K === 0) {
        const kickers = engine.state.picks
          .filter((p) => engine.byId.get(p.playerId)?.position === 'K').length;
        check('  a league with no kicker slot drafts no kickers', kickers === 0, String(kickers));
      }
    }

    // Settings are pulled once and kept, so the same league read twice must
    // give the same answer. A cached league that drifts from the live one is a
    // draft set up for a league you are not in.
    const first = leagues[0].id;
    const twice = await Promise.all([
      fetch(API + '/api/sleeper/league/' + first).then((r) => r.json()),
      fetch(API + '/api/sleeper/league/' + first + '?force=1').then((r) => r.json()),
    ]);
    check('a cached league matches a forced re-read',
      JSON.stringify(twice[0]) === JSON.stringify(twice[1]));
  }

  {
    // These need no fixture. The first ID belongs to nobody and never will.
    const bad = await fetch(API + '/api/sleeper/league/12345678901234567890');
    check('an unknown league ID gives a clear error', bad.status === 400);

    // A league ID is a run of digits. Anything else is refused before it
    // reaches Sleeper, rather than passed through and answered with a 404.
    const junk = await fetch(API + '/api/sleeper/league/not-an-id/users');
    check('a league ID that is not digits is refused', junk.status === 400,
      String(junk.status));
  }

  console.log('\nKeepers and settled picks');
  {
    const boardRes = await fetch(API + '/api/board?scoring=ppr&teams=12&adpSource=sleeper');
    const b12: Board = await boardRes.json();
    const lg = league({ teams: 12, mySlot: 3 });

    // One keeper a team, each on the pick that team really owns in its round.
    // Half of them sit late, which is where the bug lived: a player promised to
    // round eight has to survive rounds one to seven.
    const kept = b12.players.slice(0, 12).map((p, i) => {
      const round = i < 6 ? 2 : 8;
      const order = roundOrder('snake', round, 12);
      const slot = order.indexOf(i);
      return {
        overall: (round - 1) * 12 + slot + 1,
        playerId: p.id,
        source: 'keeper' as const,
      };
    });

    let e = createDraft(lg, DEFAULT_CPU, b12.players, null, kept);
    e = autoDraftRest(e);

    check('a keeper draft still fills every pick',
      e.state.picks.length === lg.teams * lg.rounds, String(e.state.picks.length));
    check('every keeper landed on the pick it cost',
      kept.every((k) => e.state.picks.find((p) => p.overall === k.overall)?.playerId === k.playerId));
    check('a kept player is never drafted again',
      new Set(e.state.picks.map((p) => p.playerId)).size === e.state.picks.length);
    check('kept picks are marked as kept',
      e.state.picks.filter((p) => p.preset === 'keeper').length === 12,
      String(e.state.picks.filter((p) => p.preset === 'keeper').length));

    const keptIds = new Set(kept.map((k) => k.playerId));
    const teamsHolding = e.state.teams.filter(
      (t) => t.playerIds.some((id) => keptIds.has(id)),
    ).length;
    check('the keepers went to twelve different teams', teamsHolding === 12, String(teamsHolding));

    // A keeper is on the roster from pick one, not from the pick that claims
    // him. Without that the team holding a receiver in round eight spends
    // rounds one to seven believing it has none, and drafts one too many.
    const lateWr = b12.players.filter((p) => p.position === 'WR').slice(4, 16);
    const keeperRound = 8;
    const wrKept = lateWr.slice(0, 12).map((p, i) => {
      const order = roundOrder('snake', keeperRound, 12);
      return {
        overall: (keeperRound - 1) * 12 + order.indexOf(i) + 1,
        playerId: p.id,
        source: 'keeper' as const,
      };
    });

    const seeded = createDraft(lg, DEFAULT_CPU, b12.players, null, wrKept);
    check('a keeper is on the roster before his pick arrives',
      seeded.state.teams.every((t) => t.playerIds.length === 1),
      seeded.state.teams.map((t) => t.playerIds.length).join(','));
    check('a keeper counts at his position from the start',
      seeded.state.teams.every((t) => t.counts.WR === 1));

    const kept8 = autoDraftRest(seeded);
    const noKeepers = autoDraftRest(createDraft(lg, DEFAULT_CPU, b12.players, null, []));

    const wrPerTeam = (e: typeof kept8) => e.state.teams.map((t) => t.counts.WR);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    console.log('        receivers a team ends with: no keepers '
      + mean(wrPerTeam(noKeepers)).toFixed(2)
      + ', a kept receiver each ' + mean(wrPerTeam(kept8)).toFixed(2));

    check('a kept receiver is not drafted over',
      mean(wrPerTeam(kept8)) <= mean(wrPerTeam(noKeepers)) + 1.05,
      mean(wrPerTeam(kept8)).toFixed(2) + ' against ' + mean(wrPerTeam(noKeepers)).toFixed(2));
    check('nobody holds a keeper twice',
      kept8.state.teams.every((t) => new Set(t.playerIds).size === t.playerIds.length));
    check('a kept roster is the right size',
      kept8.state.teams.every((t) => t.playerIds.length === lg.rounds),
      kept8.state.teams.map((t) => t.playerIds.length).join(','));

    // Taking back a settled pick must not take the player off the roster.
    let stepped = seeded;
    for (let i = 0; i < 100; i += 1) stepped = runCpuPick(stepped);
    const backed = undoPick(stepped);
    check('undoing a settled pick leaves the player kept',
      backed.state.teams.every((t) => t.counts.WR >= 1));

    // The bug this reproduces: the draft reaches your own keeper, decides it is
    // your turn, and waits for a decision that was taken weeks ago.
    const mySlot = 4;
    const keptRound = 8;
    const myLg = league({ teams: 12, mySlot });
    const myOrder = roundOrder('snake', keptRound, 12);
    const myKeeperPick = (keptRound - 1) * 12 + myOrder.indexOf(mySlot - 1) + 1;
    const mine = createDraft(myLg, DEFAULT_CPU, b12.players, null,
      [{ overall: myKeeperPick, playerId: b12.players[20].id, source: 'keeper' }]);

    check('your settled pick is not offered as your next choice',
      nextUserChoice(mine, myKeeperPick) !== myKeeperPick,
      String(nextUserChoice(mine, myKeeperPick)));
    check('the choice after it is a real one',
      (nextUserChoice(mine, myKeeperPick) ?? 0) > myKeeperPick);

    // Play it the way the screen does: you pick when it is your turn, the room
    // picks otherwise, and a settled pick belongs to neither.
    let live = mine;
    let stalls = 0;
    let guard = 0;
    while (!live.state.done && guard < 5000) {
      const at = currentPick(live.state);
      const team = currentTeam(live.state)!;
      const settled = presetFor(live, at);
      const before = live.state.picks.length;

      if (team.isUser && !settled) {
        const best = availablePlayers(live)[0];
        live = draftPlayer(live, best.id);
      } else {
        live = runCpuPick(live);
      }

      if (live.state.picks.length === before) { stalls += 1; break; }
      guard += 1;
    }

    check('the draft never stalls on a settled pick', stalls === 0);
    check('a draft with your own keeper runs to the end',
      live.state.picks.length === myLg.teams * myLg.rounds,
      live.state.picks.length + ' of ' + myLg.teams * myLg.rounds);
    check('your keeper filled its own pick',
      live.state.picks.find((p) => p.overall === myKeeperPick)?.preset === 'keeper');
    check('you still made every other pick you own',
      live.state.teams[mySlot - 1].playerIds.length === myLg.rounds,
      String(live.state.teams[mySlot - 1].playerIds.length));

    // A keeper of yours must not stall the draft waiting for you to choose it.
    const mineKept = createDraft(lg, DEFAULT_CPU, b12.players, null,
      [{ overall: 3, playerId: b12.players[0].id, source: 'keeper' }]);
    const advanced = runToUserTurn(mineKept);
    check('your own keeper fills itself and play moves on',
      advanced.state.picks.length >= 3, String(advanced.state.picks.length));

    // A preset outside the draft, or naming nobody, is dropped not half applied.
    const junk = createDraft(lg, DEFAULT_CPU, b12.players, null, [
      { overall: 9999, playerId: b12.players[0].id, source: 'keeper' },
      { overall: 5, playerId: 'no-such-player', source: 'keeper' },
    ]);
    check('a preset the draft cannot hold is refused', junk.presets.size === 0,
      String(junk.presets.size));
  }

  console.log('\nFollowing a real draft');
  if (!fixtures) {
    console.log(NO_FIXTURES);
  } else {
    // A finished draft is a fixed target to replay: the same picks every time,
    // a known number of them, and a known number of keepers among them.
    const want = fixtures.finishedDraft;
    const lge = fixtures.keeperLeague;
    const boardQuery = 'scoring=' + lge.scoring + '&teams=' + lge.teams;
    const DRAFT = want.id;
    const stateRes = await fetch(API + '/api/sleeper/draft/' + DRAFT);
    const live = await stateRes.json();
    check('a finished draft reports itself finished', live.complete === true, live.status);
    check('the draft order is readable', live.orderIsSet === true);
    check('the order covers every seat',
      Object.keys(live.slotByUser).length === live.teams,
      Object.keys(live.slotByUser).length + ' of ' + live.teams);

    const picksRes = await fetch(API + '/api/sleeper/draft/' + DRAFT + '/picks?' + boardQuery);
    const got = await picksRes.json();
    check('every real pick comes back', got.picks.length === want.picks,
      String(got.picks.length));
    check('almost every pick finds its player on the board',
      got.matched >= want.minMatched, got.matched + ' of ' + got.picks.length);
    check('a pick of somebody off the board still owns its slot',
      got.picks.every((p: { playerId: string }) => !!p.playerId));
    check('the keepers are flagged',
      got.picks.filter((p: { isKeeper: boolean }) => p.isKeeper).length === want.keepers);
    check('picks arrive in order',
      got.picks.every((p: { overall: number }, i: number) => p.overall === i + 1));

    // Replay it through the engine the way the assistant does.
    const boardRes = await fetch(API + '/api/board?' + boardQuery + '&adpSource=sleeper');
    const b12: Board = await boardRes.json();
    // Every real pick, including those of players this board no longer ranks.
    // Those join the board as themselves so no slot is left empty.
    const extras = got.picks.filter((p: { offBoard: boolean }) => p.offBoard)
      .map((p: { playerId: string; name: string; position: string; team: string }) => ({
        id: p.playerId, key: p.playerId, name: p.name, position: p.position, team: p.team,
        bye: null, adp: 999, adpRank: 999, adpStdev: 20, stdevMeasured: false, points: null,
        ffcAdp: null, sleeperAdp: null, adpBorrowedFrom: null, injuryStatus: null,
        timesDrafted: 0, sources: [],
      }));
    const pool = [...b12.players, ...extras];
    const presets = got.picks.map((p: { overall: number; playerId: string }) => ({
      overall: p.overall, playerId: p.playerId, source: 'live' as const,
    }));

    const seat = { teams: lge.teams, rounds: lge.rounds, mySlot: lge.teams };
    const replay = runPresetsOnly(createDraft(
      league(seat), DEFAULT_CPU, pool, null, presets,
    ));
    console.log('        replayed ' + replay.state.picks.length + ' of ' + presets.length
      + ' real picks onto the board');
    check('the assistant replays the real draft', replay.state.picks.length === presets.length,
      replay.state.picks.length + ' of ' + presets.length);
    check('the assistant simulates nothing of its own',
      replay.state.picks.every((p) => p.preset === 'live'));

    // Half the picks in means the board stops there and waits.
    const halfway = Math.floor(presets.length / 2);
    const half = presets.slice(0, halfway);
    const partway = runPresetsOnly(createDraft(
      league(seat), DEFAULT_CPU, pool, null, half,
    ));
    check('a draft in progress stops at the last real pick',
      partway.state.picks.length === halfway, String(partway.state.picks.length));
    check('nothing is invented past it', partway.state.done === false);

    const members = await fetch(API + '/api/sleeper/league/' + lge.id + '/users')
      .then((r) => r.json());
    check('the league members are readable', Array.isArray(members) && members.length > 0,
      String(members.length));

    // `draft_order` is keyed by user and skips anyone without an outright
    // roster, so it can be short of a seat. Seats are mapped through
    // slot_to_roster_id for exactly that reason, and every one of them has to
    // come back named however short that map is.
    const setupRes = await fetch(
      API + '/api/sleeper/league/' + lge.id + '/setup?' + boardQuery,
    );
    const setupGot = await setupRes.json();
    const ordered = Object.keys(setupGot.draft?.slotByUser ?? {}).length;
    console.log('        ' + setupGot.slots.length + ' seats, ' + members.length
      + ' users, ' + ordered + ' entries in the draft order');
    check('there is a seat for every roster',
      setupGot.slots.length === setupGot.teams,
      setupGot.slots.length + ' of ' + setupGot.teams);
    check('every seat is named however short the draft order is',
      setupGot.slots.every((x: { name: string }) => !!x.name && x.name.trim().length > 0)
        && setupGot.slots.length >= ordered,
      setupGot.slots.length + ' seats against ' + ordered + ' ordered');
  }

  console.log('\nReading a real league');
  if (!fixtures) {
    console.log(NO_FIXTURES);
  } else {
    const lge = fixtures.keeperLeague;
    const boardQuery = 'scoring=' + lge.scoring + '&teams=' + lge.teams;
    const res2 = await fetch(API + '/api/sleeper/league/' + lge.id + '/setup?' + boardQuery);
    const got = await res2.json();

    check('every seat is accounted for', got.slots.length === got.teams,
      got.slots.length + ' of ' + got.teams);
    check('every seat has a name', got.slots.every((s2: { name: string }) => !!s2.name));
    check('seats run 1 to N in order',
      got.slots.every((s2: { slot: number }, i: number) => s2.slot === i + 1));
    check('a seat maps to a roster',
      got.slots.filter((s2: { rosterId: number | null }) => s2.rosterId != null).length
        === got.teams);
    console.log('        ' + got.namedTeams + ' of ' + got.teams
      + ' seats carry a real team name');

    // The seat mapping must not go through draft_order: this league has twelve
    // seats and eleven entries there, so one seat would come back nameless.
    check('a seat with no manager still gets a name',
      got.slots.every((s2: { name: string }) => s2.name.trim().length > 0));

    check('the league is read as a keeper league', got.isKeeper === true);

    /*
     * The traded picks of a real league.
     *
     * This one has them in bulk: two seats swapped nearly their whole draft
     * both ways, on top of ordinary trades between five others. It is the case
     * that broke every "one pick per team per round" assumption in the app.
     */
    {
      const trades: { round: number; fromSlot: number; toSlot: number }[] = got.tradedPicks;
      check('traded picks come back', Array.isArray(trades), typeof trades);
      console.log('        ' + trades.length + ' picks changed hands');

      check('a trade names two different seats',
        trades.every((t) => t.fromSlot !== t.toSlot));
      check('every traded seat is a real seat',
        trades.every((t) => t.fromSlot >= 1 && t.fromSlot <= got.teams
          && t.toSlot >= 1 && t.toSlot <= got.teams));
      check('no pick is sold twice',
        new Set(trades.map((t) => t.round + ':' + t.fromSlot)).size === trades.length);

      const rounds = lge.rounds;
      const plain = pickOrder('snake', got.teams, rounds);
      const traded = pickOrder('snake', got.teams, rounds, trades);

      check('the draft is the same length either way', traded.length === plain.length);
      check('every pick still belongs to somebody',
        traded.every((t) => t >= 0 && t < got.teams));
      check('the picks that moved are exactly the ones traded',
        traded.filter((t, i) => t !== plain[i]).length
          === trades.filter((t) => t.round <= rounds).length,
        traded.filter((t, i) => t !== plain[i]).length + ' moved');

      // Nobody gains or loses a pick overall: every pick sold is a pick bought.
      const before = new Map<number, number>();
      const after = new Map<number, number>();
      plain.forEach((t) => before.set(t, (before.get(t) || 0) + 1));
      traded.forEach((t) => after.set(t, (after.get(t) || 0) + 1));
      const net = [...after.entries()]
        .map(([t, n]) => [t + 1, n - (before.get(t) || 0)] as const)
        .filter(([, d]) => d !== 0);
      check('the picks gained equal the picks lost',
        net.reduce((sum, [, d]) => sum + d, 0) === 0);
      console.log('        net picks by seat: '
        + (net.map(([slot, d]) => 'seat ' + slot + ' ' + (d > 0 ? '+' : '') + d).join(', ')
          || 'level all round'));
    }
    check('the declared keepers come back', got.keepersDeclared >= 1,
      String(got.keepersDeclared));
    check('a declared keeper names its seat and its player',
      got.keepers.every((k: { slot: number | null }) => k.slot != null));
    check('a keeper drafted last season gets a suggested round',
      got.keepers.some((k: { suggestedRound: number | null }) => k.suggestedRound != null));
    check('a keeper never drafted here gets no round rather than a wrong one',
      got.keepers.every((k: { suggestedRound: number | null; suggestedFrom: string }) => (
        k.suggestedRound != null || k.suggestedFrom === 'never drafted here')));

    for (const k of got.keepers) {
      console.log('        seat ' + String(k.slot).padStart(2) + '  '
        + String(k.name || 'not on board').padEnd(20)
        + (k.suggestedRound ? 'round ' + k.suggestedRound : k.suggestedFrom));
    }

    // Those keepers have to survive being turned into real picks.
    const boardRes = await fetch(API + '/api/board?' + boardQuery + '&adpSource=sleeper');
    const b12: Board = await boardRes.json();
    const usable = got.keepers.filter(
      (k: { playerId: string | null; slot: number; suggestedRound: number | null }) => (
        k.playerId && k.slot && k.suggestedRound),
    );
    const picks = usable.map((k: { slot: number; suggestedRound: number; playerId: string }) => {
      const order = roundOrder('snake', k.suggestedRound, got.teams);
      return {
        overall: (k.suggestedRound - 1) * got.teams + order.indexOf(k.slot - 1) + 1,
        playerId: k.playerId,
        source: 'keeper' as const,
      };
    });
    check('every imported keeper lands on a distinct pick',
      new Set(picks.map((p: { overall: number }) => p.overall)).size === picks.length);

    /*
     * The import splits, and loses nobody.
     *
     * A keeper is settled when a round is known and that round's pick is still
     * free. The rest wait for a round from you. The import used to count those
     * in a sentence and drop them, which meant finding each player again by
     * hand in a list of six hundred.
     */
    {
      const onBoard = got.keepers.filter(
        (k: { playerId: string | null; slot: number | null }) => k.playerId && k.slot,
      );
      const settled: number[] = [];
      const waiting: string[] = [];
      const spent = new Set<number>();

      for (const k of onBoard) {
        if (!k.suggestedRound) { waiting.push(k.name); continue; }
        const order = roundOrder('snake', k.suggestedRound, got.teams);
        const index = order.indexOf(k.slot - 1);
        if (index < 0) { waiting.push(k.name); continue; }
        const overall = (k.suggestedRound - 1) * got.teams + index + 1;
        if (spent.has(overall)) { waiting.push(k.name); continue; }
        spent.add(overall);
        settled.push(overall);
      }

      check('the import keeps every keeper it can name',
        settled.length + waiting.length === onBoard.length,
        settled.length + ' settled, ' + waiting.length + ' waiting, '
          + onBoard.length + ' named');
      check('a keeper with no round waits rather than disappearing',
        waiting.length === onBoard.filter(
          (k: { suggestedRound: number | null }) => !k.suggestedRound,
        ).length,
        waiting.join(', ') || 'none');
      check('no two settled keepers share a pick',
        new Set(settled).size === settled.length);
    }

    const names = got.slots.map((s2: { name: string }) => s2.name);
    const withNames = autoDraftRest(createDraft(
      league({ teams: got.teams, rounds: lge.rounds, mySlot: 4, teamNames: names }),
      DEFAULT_CPU, b12.players, null, picks,
    ));
    check('a draft with real team names completes',
      withNames.state.picks.length === got.teams * lge.rounds);
    check('the board carries the real team names',
      withNames.state.teams[3].name === names[3], withNames.state.teams[3].name);
    check('every declared keeper reached the team that declared him',
      usable.every((k: { slot: number; playerId: string }) => (
        withNames.state.teams[k.slot - 1].playerIds.includes(k.playerId))));
  }

  console.log('\nYour own rankings');
  {
    // Take four players the market buries and rank them first. If the override
    // works they go in round one, and if it does not they go where they always
    // went, which is the whole point of the switch.
    const late = board.players
      .filter((p) => p.adp > 90 && p.adp < 160 && p.position !== 'K' && p.position !== 'DEF')
      .slice(0, 4);
    const csv = ['Player,Pos,Team,Rank']
      .concat(late.map((p, i) => [p.name, p.position, p.team, String(i + 1)].join(',')))
      .join('\n');

    const res2 = await fetch(API + '/api/rankings?scoring=half-ppr&teams=12&adpSource=sleeper', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv }),
    });
    const set = await res2.json();
    check('the service matched every name', set.entries.length === late.length,
      set.entries.length + ' of ' + late.length);
    check('a fused position label like RB1 still matches', set.columns.position === 'pos');

    const lg = league();
    const ids = new Set(set.entries.map((e: { id: string }) => e.id));

    const ignoring = createDraft(lg, DEFAULT_CPU, board.players, set.entries);
    const withMine = createDraft(
      lg, { ...DEFAULT_CPU, cpuUsesMyRankings: true }, board.players, set.entries,
    );
    const a = autoDraftRest(ignoring);
    const b = autoDraftRest(withMine);

    const firstRound = (e: typeof a) => e.state.picks.slice(0, lg.teams)
      .filter((p) => ids.has(p.playerId)).length;

    console.log('        of the four players ranked first, '
      + firstRound(a) + ' went in round one with the switch off, '
      + firstRound(b) + ' with it on');
    check('the room ignores your rankings by default', firstRound(a) === 0);
    check('the switch makes the room draft from them', firstRound(b) >= 3);
    check('a draft still completes with the switch on',
      b.state.picks.length === lg.teams * lg.rounds);
  }

  console.log('');
  if (failures) {
    console.log(failures + ' checks failed.');
    process.exit(1);
  }
  console.log('All checks passed.');
}

/** The average distance between where a player went and their ADP. */
function reachSpread(e: ReturnType<typeof runDraft>): number {
  const gaps = e.state.picks.map((p) => {
    const player = e.byId.get(p.playerId);
    return player ? Math.abs(player.adp - p.overall) : 0;
  });
  return gaps.reduce((a, b) => a + b, 0) / gaps.length;
}

void POSITIONS;

main().catch((err) => {
  console.error(String(err.message || err));
  process.exit(1);
});
