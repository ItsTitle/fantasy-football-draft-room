import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchBoard, fetchDraftPicks, fetchLeagueSetup, fetchSleeperLeague, matchRankings,
} from './api';
import { maskLeague } from './anon';
import { keeperPicksIn } from './engine/order';
import { livePresets, mergePresets, offBoardPlayer } from './engine/live';
import DraftScreen from './components/DraftScreen';
import ResultsScreen from './components/ResultsScreen';
import SetupScreen from './components/SetupScreen';
import { createDraft, runToUserTurn } from './engine/draft';
import type { DraftEngine } from './engine/draft';
import { rosterSize } from './engine/roster';
import type {
  AppMode, Board, CpuConfig, DeclaredKeeper, LeagueConfig, LeagueImport, LeagueSetup,
  Overrides, PendingKeeper, PresetPick, RankingSet, SavedLeague,
} from './engine/types';
import type { RankingSource } from './storage';
import { load, save } from './storage';

type Screen = 'setup' | 'draft' | 'results';

export default function App() {
  const saved = useRef(load()).current;

  const [league, setLeague] = useState<LeagueConfig>(saved.league);
  const [cpu, setCpu] = useState<CpuConfig>(saved.cpu);
  const [preset, setPreset] = useState(saved.cpuPreset);
  const [pace, setPace] = useState(saved.pace);

  const [mode, setMode] = useState<AppMode>(saved.mode);
  const [anonymous, setAnonymous] = useState(saved.anonymous);

  const [rankings, setRankings] = useState<RankingSet | null>(saved.rankings);
  const [rankingSource, setRankingSource] = useState<RankingSource | null>(saved.rankingSource);
  const [overrides, setOverrides] = useState<Overrides>(saved.overrides);
  const [rankingsBusy, setRankingsBusy] = useState(false);

  const [savedLeagues, setSavedLeagues] = useState<SavedLeague[]>(saved.savedLeagues);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(saved.activeLeagueId);
  const [myManager, setMyManager] = useState<string | null>(saved.myManager);

  /*
   * RESUMING A MOCK FROM THE REAL DRAFT
   *
   * Once a draft is under way, the useful question stops being "how might this
   * whole draft go" and becomes "how might the next three rounds go, from here".
   * This reads what the room has actually taken and simulates only the rest.
   */
  const [resumeLive, setResumeLive] = useState(saved.resumeLive);
  const [liveCount, setLiveCount] = useState<{ picks: number; at: number } | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  /*
   * The league you had loaded comes back with the page.
   *
   * This used to start empty on every reload while the league it describes was
   * saved and restored around it. The keepers you entered were still there and
   * the panel that shows them was not, because that panel only appears for a
   * keeper league and only this told it that it was one. Refreshing the page
   * looked exactly like losing the lot.
   */
  const [importedLeague, setImportedLeague] = useState<LeagueImport | null>(
    () => saved.savedLeagues.find((l) => l.id === saved.activeLeagueId)?.settings ?? null,
  );
  const [leagueBusy, setLeagueBusy] = useState(false);
  const [leagueError, setLeagueError] = useState<string | null>(null);

  const [setup, setSetup] = useState<LeagueSetup | null>(null);
  const [keeperImportBusy, setKeeperImportBusy] = useState(false);
  const [keeperImportNote, setKeeperImportNote] = useState<string | null>(null);

  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const [engine, setEngine] = useState<DraftEngine | null>(null);
  const [screen, setScreen] = useState<Screen>('setup');

  // A different scoring format is a different board, and a different board can
  // match a different set of names. Run the file again rather than leave a
  // stale list of misses on screen.
  const lastMatched = useRef('');

  useEffect(() => {
    save({
      league, cpu, rankings, rankingSource, overrides, savedLeagues, activeLeagueId,
      cpuPreset: preset, pace, mode, anonymous, myManager, resumeLive,
    });
  }, [league, cpu, rankings, rankingSource, overrides, savedLeagues, activeLeagueId, preset, pace,
    mode, anonymous, myManager, resumeLive]);

  const activeLeague = savedLeagues.find((l) => l.id === activeLeagueId) || null;
  const keepers = activeLeague?.keepers ?? [];
  const pendingKeepers = activeLeague?.pendingKeepers ?? [];
  const liveDraftId = importedLeague?.draftId ?? null;
  // Only a draft that has opened has picks to resume from.
  const liveStarted = !!setup?.draft?.started;

  const leagueLabel = useMemo(() => {
    if (!activeLeague) return 'your league';
    return maskLeague(activeLeague.name, savedLeagues.indexOf(activeLeague), anonymous);
  }, [activeLeague, savedLeagues, anonymous]);

  /** Change one field on the league that is loaded. */
  const patchLeague = useCallback((id: string, patch: Partial<SavedLeague>) => {
    setSavedLeagues((list) => list.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  // The board depends only on the four things that change it. Changing your
  // draft slot or the roster shape must not throw the pool away.
  useEffect(() => {
    const control = new AbortController();
    setLoading(true);
    setError(null);
    fetchBoard(
      {
        scoring: league.scoring,
        teams: league.teams,
        adpSource: league.adpSource,
        year: league.year,
        force: refreshToken > 0,
      },
      control.signal,
    )
      .then((next) => { setBoard(next); setLoading(false); })
      .catch((err) => {
        if (control.signal.aborted) return;
        setError(String(err.message || err));
        setLoading(false);
      });
    return () => control.abort();
  }, [league.scoring, league.teams, league.adpSource, league.year, refreshToken]);

  /**
   * Run a ranking file against the board with the current overrides applied.
   *
   * Every path that changes either the file or the overrides comes through
   * here, so a mapping takes effect the moment it is saved rather than at the
   * next upload.
   */
  const runMatch = useCallback(async (source: RankingSource, withOverrides: Overrides) => {
    setRankingsBusy(true);
    try {
      const set = await matchRankings(
        {
          scoring: league.scoring,
          teams: league.teams,
          adpSource: league.adpSource,
          year: league.year,
        },
        source.text,
        source.label,
        withOverrides,
        source.rankColumn,
      );
      setRankings(set);
      setRankingSource(source);
      // A ranking file belongs to the league it was published for. Your leagues
      // are standard, half PPR and PPR, and every site ships one file per
      // format, so a single shared set would mean re-uploading on every switch.
      if (activeLeagueId) patchLeague(activeLeagueId, { rankingSource: source });
    } catch (err) {
      setError('Your rankings could not be matched. ' + String((err as Error).message));
    } finally {
      setRankingsBusy(false);
    }
  }, [league.scoring, league.teams, league.adpSource, league.year, activeLeagueId, patchLeague]);

  const loadRankings = useCallback((text: string, label: string) => {
    // A new file gets a fresh look at its columns. The column you chose for the
    // last file says nothing about this one.
    void runMatch({ text, label, rankColumn: null }, overrides);
  }, [runMatch, overrides]);

  const setRankColumn = useCallback((index: number) => {
    if (!rankingSource) return;
    void runMatch({ ...rankingSource, rankColumn: index }, overrides);
  }, [rankingSource, overrides, runMatch]);

  const setOverride = useCallback((key: string, playerId: string | null) => {
    const next = { ...overrides, [key]: playerId };
    setOverrides(next);
    if (rankingSource) void runMatch(rankingSource, next);
  }, [overrides, rankingSource, runMatch]);

  const forgetOverride = useCallback((key: string) => {
    const next = { ...overrides };
    delete next[key];
    setOverrides(next);
    if (rankingSource) void runMatch(rankingSource, next);
  }, [overrides, rankingSource, runMatch]);

  useEffect(() => {
    if (!rankingSource || !board || rankingsBusy) return;
    const stamp = [league.scoring, league.teams, league.adpSource, league.year].join('|');
    if (lastMatched.current === stamp) return;
    lastMatched.current = stamp;
    void runMatch(rankingSource, overrides);
  }, [board, rankingSource, league.scoring, league.teams, league.adpSource, league.year]);

  /** Apply a Sleeper league to the settings, keeping the draft slot you chose. */
  const applyImport = useCallback((imported: LeagueImport) => {
    setImportedLeague(imported);
    setActiveLeagueId(imported.id);
    setSetup(null);
    setKeeperImportNote(null);

    // Swap to this league's own ranking file. The effect below re-matches it
    // against the new board, so a league in a different scoring format arrives
    // with the rankings that were written for that format.
    const stored = savedLeagues.find((l) => l.id === imported.id)?.rankingSource ?? null;
    setRankingSource(stored);
    if (!stored) setRankings(null);
    lastMatched.current = '';

    setLeague((current) => ({
      ...current,
      teams: imported.teams,
      rounds: imported.rounds,
      roster: imported.roster,
      scoring: imported.scoring,
      draftType: imported.draftType,
      mySlot: Math.min(current.mySlot, imported.teams),
    }));
  }, [savedLeagues]);

  /**
   * Pull a league from Sleeper and keep what comes back.
   *
   * A league's shape does not move once the season is set, so this runs on the
   * first use of a league and then only when you press Refresh.
   */
  const pullSleeperLeague = useCallback(async (id: string, force = false) => {
    setLeagueBusy(true);
    setLeagueError(null);
    try {
      const imported = await fetchSleeperLeague(id, force);
      applyImport(imported);
      void loadSetup(id, force);
      const stamp = Date.now();
      setSavedLeagues((list) => (list.some((l) => l.id === imported.id)
        ? list.map((l) => (l.id === imported.id
          ? { ...l, name: imported.name, settings: imported, fetchedAt: stamp }
          : l))
        : [...list, {
          id: imported.id,
          name: imported.name,
          settings: imported,
          fetchedAt: stamp,
          rankingSource: null,
          keepers: [],
          pendingKeepers: [],
          tradedPicks: [],
          myUserId: null,
          slots: [],
        }]));
    } catch (err) {
      setLeagueError(String((err as Error).message));
    } finally {
      setLeagueBusy(false);
    }
  }, [applyImport]);

  /**
   * Read a real league: its seats, their team names, and the keepers declared
   * so far. Also sets the draft slot, once Sleeper has drawn the order.
   *
   * Called on every league load, because all of it moves. Managers rename
   * teams, keepers get declared right up to the deadline, and the draft order
   * appears at some point before the draft.
   */
  const loadSetup = useCallback(async (leagueId: string, force = false) => {
    setLeagueBusy(true);
    setLeagueError(null);
    try {
      const got = await fetchLeagueSetup(leagueId, {
        scoring: league.scoring,
        teams: league.teams,
        adpSource: league.adpSource,
        year: league.year,
      }, force);
      setSetup(got);

      const names = got.slots.map((s2) => s2.name);
      const trades = got.tradedPicks ?? [];
      patchLeague(leagueId, { slots: got.slots, tradedPicks: trades });
      setLeague((current) => ({
        ...current,
        teamNames: names.length ? names : null,
        // A traded pick changes who is on the clock, so it belongs to the draft
        // the moment the league is read rather than at start.
        tradedPicks: trades.length ? trades : null,
      }));

      /*
       * Your seat follows from who you said you are, once the order exists.
       *
       * A league you have not answered for yet is matched on your Sleeper name
       * instead. You are the same manager in all three of your leagues and the
       * seat is different in each, so the name is what carries across and the
       * seat is what it finds. Say you are somebody else and that answer wins,
       * here and in every league you load after it.
       */
      const mine = savedLeagues.find((l) => l.id === leagueId)?.myUserId;
      let seat = mine ? got.slots.find((s2) => s2.userId === mine) : null;
      if (!seat && myManager) {
        const wanted = myManager.toLowerCase();
        seat = got.slots.find((s2) => s2.manager?.toLowerCase() === wanted) ?? null;
        if (seat?.userId) patchLeague(leagueId, { myUserId: seat.userId });
      }
      if (seat) setLeague((current) => ({ ...current, mySlot: seat!.slot }));
      return got;
    } catch (err) {
      setLeagueError(String((err as Error).message));
      return null;
    } finally {
      setLeagueBusy(false);
    }
  }, [league.scoring, league.teams, league.adpSource, league.year, savedLeagues, patchLeague,
    myManager]);

  /**
   * Turn the keepers a league has declared into settled picks.
   *
   * Sleeper publishes who is kept and by whom, and does not publish what a
   * keeper costs. The round is taken from where the player went last season,
   * which is what most leagues charge, and is left for you to correct. A
   * player nobody drafted here has no suggestion at all and needs a round.
   */
  const importKeepers = useCallback(async () => {
    if (!activeLeagueId) return;
    setKeeperImportBusy(true);
    setKeeperImportNote(null);
    try {
      const got = setup?.leagueId === activeLeagueId ? setup : await loadSetup(activeLeagueId, true);
      if (!got) return;

      const teams = got.teams || league.teams;
      const onBoard = got.keepers.filter((k: DeclaredKeeper) => k.playerId && k.slot);

      /*
       * A keeper is settled only when a round is known and that round's pick is
       * still free. Everything else that names a real player in a real seat is
       * kept as pending rather than dropped: the import already knows who, and
       * whose, and the only thing missing is the one field Sleeper never
       * publishes. Reporting those in a sentence and throwing them away made
       * you find each player again by hand.
       */
      const settled: PresetPick[] = [];
      const pending: PendingKeeper[] = [];
      const taken = new Set<number>();

      const describe = (k: DeclaredKeeper, reason: PendingKeeper['reason'], tried: number | null) => ({
        playerId: k.playerId!,
        slot: k.slot!,
        name: k.name || 'Unknown player',
        position: k.position || '',
        team: k.team || '',
        reason,
        triedRound: tried,
      });

      const trades = got.tradedPicks ?? [];

      for (const k of onBoard) {
        if (!k.suggestedRound) {
          pending.push(describe(k, 'no-history', null));
          continue;
        }
        // A keeper spends a pick that team actually holds. Trade your fifth
        // away and you cannot charge a keeper to the fifth, and a round you
        // traded into gives you a pick to charge one to.
        const held = keeperPicksIn(
          league.draftType, teams, k.suggestedRound, k.slot! - 1, trades,
        );
        const free = held.find((overall) => !taken.has(overall));
        if (free == null) {
          // Either the seat holds nothing in that round, or every pick it does
          // hold is already spent on an earlier keeper.
          pending.push(describe(k, held.length ? 'round-taken' : 'no-history', k.suggestedRound));
          continue;
        }
        taken.add(free);
        settled.push({ overall: free, playerId: k.playerId!, source: 'keeper' });
      }

      patchLeague(activeLeagueId, { keepers: settled, pendingKeepers: pending });

      const noPlayer = got.keepers.filter((k) => !k.playerId).length;
      const parts = ['Read ' + settled.length + ' of ' + got.keepers.length
        + ' declared keepers. Rounds are taken from last season and are a guess.'];
      if (pending.length) {
        parts.push(pending.length === 1
          ? 'One needs a round from you, below.'
          : pending.length + ' need a round from you, below.');
      }
      if (noPlayer) {
        parts.push(noPlayer + (noPlayer === 1 ? ' is' : ' are') + ' not on this board.');
      }
      setKeeperImportNote(parts.join(' '));
    } catch (err) {
      setKeeperImportNote(String((err as Error).message));
    } finally {
      setKeeperImportBusy(false);
    }
  }, [activeLeagueId, setup, loadSetup, league, patchLeague]);

  /**
   * Settle a pending keeper by saying which round he costs.
   *
   * The seat is already known, so the round is the whole answer: it decides
   * which of that seat's picks the keeper spends. A round whose pick is already
   * spent is refused rather than taken, and the panel says which round to try.
   */
  const setKeeperRound = useCallback((playerId: string, round: number) => {
    if (!activeLeagueId || !activeLeague) return;
    const waiting = activeLeague.pendingKeepers.find((k) => k.playerId === playerId);
    if (!waiting) return;

    const held = keeperPicksIn(
      league.draftType, league.teams, round, waiting.slot - 1, league.tradedPicks,
    );
    const overall = held.find((at) => !activeLeague.keepers.some((k) => k.overall === at));
    if (overall == null) return;

    patchLeague(activeLeagueId, {
      keepers: [...activeLeague.keepers, { overall, playerId, source: 'keeper' }],
      pendingKeepers: activeLeague.pendingKeepers.filter((k) => k.playerId !== playerId),
    });
  }, [activeLeagueId, activeLeague, league.draftType, league.teams, league.tradedPicks,
    patchLeague]);

  /** Leave a pending keeper out. He goes back into the pool for the room. */
  const dropPendingKeeper = useCallback((playerId: string) => {
    if (!activeLeagueId || !activeLeague) return;
    patchLeague(activeLeagueId, {
      pendingKeepers: activeLeague.pendingKeepers.filter((k) => k.playerId !== playerId),
    });
  }, [activeLeagueId, activeLeague, patchLeague]);

  /** Load a saved league from what is already kept, pulling only if it is new. */
  const loadSleeperLeague = useCallback((id: string) => {
    const existing = savedLeagues.find((l) => l.id === id);
    if (existing?.settings) {
      setLeagueError(null);
      applyImport(existing.settings);
    } else {
      void pullSleeperLeague(id);
    }
    // Team names, keepers and the draft order all move, so they are read every
    // time even though the league's own shape is cached.
    void loadSetup(id);
  }, [savedLeagues, applyImport, pullSleeperLeague, loadSetup]);

  /**
   * Begin a mock, optionally from where the real draft has got to.
   *
   * Resuming reads the picks that have actually been made and hands them to the
   * engine as settled, then simulates only what is left. It is the same claim a
   * keeper makes, so the two go in together and the real pick wins where they
   * disagree: a keeper entry is what was expected, and a pick is what happened.
   */
  const startMock = useCallback(async () => {
    if (!board) return;

    let presets = keepers;
    let players = board.players;

    if (resumeLive && liveDraftId) {
      setStartError(null);
      setStarting(true);
      try {
        const live = await fetchDraftPicks(liveDraftId, {
          scoring: league.scoring,
          teams: league.teams,
          adpSource: league.adpSource,
          year: league.year,
        });
        presets = mergePresets(keepers, livePresets(live.picks));
        // A player the real draft took who this board does not rank still owns
        // his slot, or every pick after him sits one column out of place.
        players = [...board.players, ...live.picks.filter((p) => p.offBoard).map(offBoardPlayer)];
        setLiveCount({ picks: live.picks.length, at: Date.now() });
      } catch (err) {
        setStartError('The live draft could not be read. ' + String((err as Error).message));
        setStarting(false);
        return;
      } finally {
        setStarting(false);
      }
    }

    setEngine(runToUserTurn(
      createDraft(league, cpu, players, rankings?.entries ?? null, presets),
    ));
    setScreen('draft');
  }, [board, league, cpu, rankings, keepers, resumeLive, liveDraftId]);

  /** Ask how far the real draft has got, without starting anything. */
  const checkLive = useCallback(async () => {
    if (!liveDraftId) return;
    setLiveBusy(true);
    setStartError(null);
    try {
      const live = await fetchDraftPicks(liveDraftId, {
        scoring: league.scoring,
        teams: league.teams,
        adpSource: league.adpSource,
        year: league.year,
      });
      setLiveCount({ picks: live.picks.length, at: Date.now() });
    } catch (err) {
      setStartError('The live draft could not be read. ' + String((err as Error).message));
    } finally {
      setLiveBusy(false);
    }
  }, [liveDraftId, league.scoring, league.teams, league.adpSource, league.year]);

  // How far along the draft is goes stale by the minute once it opens, so it is
  // read when you ask for it and whenever the league changes under it.
  useEffect(() => {
    setLiveCount(null);
    if (mode === 'mock' && resumeLive && liveDraftId && liveStarted) void checkLive();
  }, [mode, resumeLive, liveDraftId, liveStarted]);

  const start = useCallback(() => {
    if (!board) return;
    if (mode === 'assistant') {
      // Nothing is simulated here. The board fills from Sleeper and waits.
      setEngine(createDraft(league, cpu, board.players, rankings?.entries ?? null, []));
      setScreen('draft');
      return;
    }
    void startMock();
  }, [board, league, cpu, rankings, mode, startMock]);

  // A new seed, drawn once and used for both the saved settings and the draft
  // that runs off them. Two draws here would mean the settings no longer
  // describe the draft on screen.
  const restart = useCallback(() => {
    if (!board) return;
    const seed = Math.floor(Math.random() * 1e9);
    const next = { ...league, seed };
    setLeague(next);
    setEngine(runToUserTurn(
      createDraft(next, cpu, board.players, rankings?.entries ?? null, keepers),
    ));
    setScreen('draft');
  }, [board, league, cpu, rankings, keepers]);

  return (
    <div className="shell">
      <header className="masthead">
        <span className="wordmark">
          Draft
          <span>·</span>
          Room
        </span>
        <span className={'mode-badge' + (mode === 'assistant' ? ' is-live' : '')}>
          {mode === 'assistant' ? 'Draft assistant' : 'Mock'}
        </span>

        {board && (
          <span className="hint" style={{ marginLeft: 'auto' }}>
            {board.meta.year}
            {' · '}
            {board.meta.formatLabel}
            {' · '}
            {board.meta.poolSize}
            {' players'}
          </span>
        )}
        <span className="hint attribution">
          ADP from Sleeper and
          {' '}
          <a href="https://fantasyfootballcalculator.com" target="_blank" rel="noreferrer" style={{ color: 'var(--chalk-2)' }}>
            Fantasy Football Calculator
          </a>
          . Projections from Rotowire via Sleeper.
        </span>

        {/*
          * One click before you record anything. League names, league IDs and
          * every manager's Sleeper name are replaced on screen. Nothing stored
          * changes, so it turns off again with nothing lost.
          */}
        <button
          type="button"
          className="anon-toggle"
          aria-pressed={anonymous}
          title={anonymous
            ? 'Real league and manager names are hidden. Click to show them.'
            : 'Hide league names, league IDs and manager names, for sharing.'}
          onClick={() => setAnonymous((v) => !v)}
        >
          {anonymous ? 'Names hidden' : 'Hide names'}
        </button>
      </header>

      {screen === 'setup' && (
        <SetupScreen
          league={league}
          cpu={cpu}
          preset={preset}
          pace={pace}
          board={board}
          loading={loading}
          error={error}
          rankings={rankings}
          overrides={overrides}
          rankingsBusy={rankingsBusy}
          savedLeagues={savedLeagues}
          activeLeagueId={activeLeagueId}
          importedLeague={importedLeague}
          leagueBusy={leagueBusy}
          leagueError={leagueError}
          onLeague={(next) => {
            // A hand edit means the settings no longer describe the league that
            // was loaded, so the loaded badge comes off.
            const shapeChanged = next.teams !== league.teams
              || next.scoring !== league.scoring
              || next.draftType !== league.draftType
              || rosterSize(next.roster) !== rosterSize(league.roster);
            if (shapeChanged) { setActiveLeagueId(null); setImportedLeague(null); }
            setLeague(next);
          }}
          onCpu={(next, id) => { setCpu(next); setPreset(id); }}
          onPace={setPace}
          onRankings={loadRankings}
          onOverride={setOverride}
          onForgetOverride={forgetOverride}
          onRankColumn={setRankColumn}
          onClearRankings={() => {
            setRankings(null);
            setRankingSource(null);
            lastMatched.current = '';
            setCpu((c) => ({ ...c, cpuUsesMyRankings: false }));
          }}
          onLoadSleeperLeague={loadSleeperLeague}
          onAddSleeperLeague={(id) => { void pullSleeperLeague(id); }}
          onRefreshSleeperLeague={(id) => { void pullSleeperLeague(id, true); }}
          onRemoveSleeperLeague={(id) => {
            setSavedLeagues((list) => list.filter((l) => l.id !== id));
            if (activeLeagueId === id) { setActiveLeagueId(null); setImportedLeague(null); }
          }}
          onStart={start}
          onRefreshBoard={() => setRefreshToken((n) => n + 1)}

          mode={mode}
          onMode={setMode}
          anonymous={anonymous}
          leagueLabel={leagueLabel}

          keepers={keepers}
          onAddKeeper={(pick) => {
            if (!activeLeagueId) return;
            patchLeague(activeLeagueId, { keepers: [...keepers, pick] });
          }}
          onRemoveKeeper={(overall) => {
            if (!activeLeagueId) return;
            patchLeague(activeLeagueId, { keepers: keepers.filter((k) => k.overall !== overall) });
          }}
          onClearKeepers={() => activeLeagueId
            && patchLeague(activeLeagueId, { keepers: [], pendingKeepers: [] })}
          pendingKeepers={pendingKeepers}
          onKeeperRound={setKeeperRound}
          onDropPending={dropPendingKeeper}
          onImportKeepers={() => { void importKeepers(); }}
          keeperImportBusy={keeperImportBusy}
          keeperImportNote={keeperImportNote}
          canImport={(setup?.keepersDeclared ?? 0) > 0}
          declared={setup?.keepersDeclared ?? 0}

          resumeLive={resumeLive}
          onResumeLive={setResumeLive}
          liveCount={liveCount}
          liveBusy={liveBusy || starting}
          liveStarted={liveStarted}
          hasDraft={!!liveDraftId}
          startError={startError}
          onCheckLive={() => { void checkLive(); }}

          setup={setup}
          myUserId={activeLeague?.myUserId ?? null}
          onMyUser={(userId) => {
            if (!activeLeagueId) return;
            patchLeague(activeLeagueId, { myUserId: userId });
            const seat = setup?.slots.find((s2) => s2.userId === userId);
            if (seat) setLeague((current) => ({ ...current, mySlot: seat.slot }));
            // The name follows you to your other leagues.
            if (seat?.manager) setMyManager(seat.manager);
          }}
          onCheckDraft={() => { if (activeLeagueId) void loadSetup(activeLeagueId, true); }}
        />
      )}

      {screen === 'draft' && engine && board && (
        <DraftScreen
          engine={engine}
          board={board}
          pace={pace}
          mode={mode}
          anonymous={anonymous}
          draftId={importedLeague?.draftId ?? null}
          rankingEntries={rankings?.entries ?? null}
          onEngine={setEngine}
          onFinish={() => setScreen('results')}
          onLeave={() => setScreen('setup')}
        />
      )}

      {screen === 'results' && engine && (
        <ResultsScreen
          engine={engine}
          anonymous={anonymous}
          onRestart={restart}
          onNewSettings={() => setScreen('setup')}
        />
      )}
    </div>
  );
}
