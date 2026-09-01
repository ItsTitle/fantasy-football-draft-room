import { useEffect, useMemo, useRef, useState } from 'react';
import DraftBoard from './DraftBoard';
import PlayerPool from './PlayerPool';
import RosterPanel from './RosterPanel';
import {
  autoDraftRest, availablePlayers, createDraft, currentPick, currentTeam, draftPlayer,
  nextUserChoice, playersOf, presetFor, runCpuPick, runPresetsOnly, runToUserTurn,
  undoToMyLastPick,
} from '../engine/draft';
import type { DraftEngine } from '../engine/draft';
import { fetchDraftPicks } from '../api';
import { maskTeam } from '../anon';
import { livePresets, offBoardPlayer } from '../engine/live';
import type { AppMode, Board } from '../engine/types';

/** How often the assistant asks Sleeper for new picks. */
const POLL_MS = 8000;

interface Props {
  engine: DraftEngine;
  board: Board;
  pace: number;
  mode: AppMode;
  anonymous: boolean;
  draftId: string | null;
  rankingEntries: import('../engine/types').RankingEntry[] | null;
  /** What you wrote about a player, by player id. Null when you wrote none. */
  notes: Map<string, string> | null;
  onEngine: (next: DraftEngine) => void;
  onFinish: () => void;
  onLeave: () => void;
}

type Pane = 'pool' | 'board' | 'roster';

function label(overall: number, teams: number): string {
  const round = Math.floor((overall - 1) / teams) + 1;
  const slot = ((overall - 1) % teams) + 1;
  return round + '.' + String(slot).padStart(2, '0');
}

export default function DraftScreen(props: Props) {
  const {
    engine, board, pace, mode, anonymous, draftId, rankingEntries, notes,
    onEngine, onFinish, onLeave,
  } = props;

  const [queue, setQueue] = useState<string[]>([]);
  const [pane, setPane] = useState<Pane>('pool');
  const [paused, setPaused] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveAt, setLiveAt] = useState<number | null>(null);
  const [unknownPicks, setUnknownPicks] = useState(0);
  const assistant = mode === 'assistant';

  const { state } = engine;
  const teams = state.league.teams;
  const pick = currentPick(state);
  const onClock = currentTeam(state);
  // A pick of yours that is already settled is not your turn. It is a keeper,
  // or a pick the real draft has already made, and the board should move past
  // it rather than sit waiting for a decision that was taken weeks ago.
  const settledNow = presetFor(engine, pick);
  const yourTurn = !!onClock?.isUser && !settledNow;
  const myNext = nextUserChoice(engine);

  // The survival bar always answers "will this player last until the next time
  // I pick". On your own turn that is the pick after this one, not this one,
  // and pointing it at the current pick would read 100 per cent for everybody.
  const oddsTarget = yourTurn ? nextUserChoice(engine, pick + 1) : myNext;

  // The clock reads the same pick the bar is measured against. On your turn
  // "your next pick" used to repeat the pick you were making, which on a phone
  // with the labels stripped out was the same number printed twice.
  const away = oddsTarget == null ? null : oddsTarget - pick;

  const available = useMemo(() => availablePlayers(engine), [engine]);
  const myTeam = state.teams.find((t) => t.isUser)!;
  const myPlayers = useMemo(() => playersOf(engine, myTeam), [engine, myTeam]);

  const myRank = engine.rankOverride;

  // Which of your players you kept rather than drafted.
  const keptIds = useMemo(() => {
    const out = new Set<string>();
    for (const [overall, preset] of engine.presets) {
      if (preset.source !== 'keeper') continue;
      if (state.teams[state.order[overall - 1]]?.isUser) out.add(preset.playerId);
    }
    return out;
  }, [engine]);

  /*
   * FOLLOWING A REAL DRAFT
   *
   * Nothing is simulated. Every few seconds the assistant asks Sleeper what has
   * happened and rebuilds the board from those picks alone, so the board is
   * never ahead of the room. Rebuilding rather than appending is deliberate: a
   * pick can be undone by a commissioner, and a board that only ever grows
   * would keep a pick that no longer exists.
   */
  const engineRef = useRef(engine);
  engineRef.current = engine;

  useEffect(() => {
    if (!assistant || !draftId || paused) return undefined;
    let alive = true;

    const poll = async () => {
      try {
        const live = await fetchDraftPicks(draftId, {
          scoring: state.league.scoring,
          teams: state.league.teams,
          adpSource: state.league.adpSource,
          year: state.league.year,
        });
        if (!alive) return;

        const presets = livePresets(live.picks);
        const extras = live.picks.filter((p) => p.offBoard).map(offBoardPlayer);

        setUnknownPicks(extras.length);
        setLiveError(null);
        setLiveAt(Date.now());

        const current = engineRef.current;
        if (current.state.picks.length === presets.length) return;

        onEngine(runPresetsOnly(createDraft(
          current.state.league,
          current.state.cpu,
          [...board.players, ...extras],
          rankingEntries,
          presets,
        )));
      } catch (err) {
        if (alive) setLiveError(String((err as Error).message));
      }
    };

    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [assistant, draftId, paused, board, rankingEntries,
    state.league.scoring, state.league.teams, state.league.adpSource, state.league.year]);

  // Run the room. One pick per tick so the board reads like a draft, or the
  // whole gap at once when the pace is set to instant.
  useEffect(() => {
    if (assistant || state.done || yourTurn || paused) return undefined;
    if (pace === 0) {
      // runToUserTurn stops at a pick you actually choose. Its own copy of that
      // rule used to live here and only checked whose pick it was, so a keeper
      // of yours halted the board and no amount of waiting moved it.
      onEngine(runToUserTurn(engine));
      return undefined;
    }
    const timer = setTimeout(() => onEngine(runCpuPick(engine)), pace);
    return () => clearTimeout(timer);
  }, [engine, yourTurn, paused, pace, state.done]);

  useEffect(() => {
    // A real draft ending is a result worth reading. A mock ending is too.
    if (state.done) onFinish();
  }, [state.done]);

  const draft = (id: string) => {
    setQueue((q) => q.filter((x) => x !== id));
    onEngine(draftPlayer(engine, id));
  };

  const takeBest = () => {
    const queued = queue.map((id) => available.find((p) => p.id === id)).filter(Boolean);
    const target = queued[0] ?? available[0];
    if (target) draft(target.id);
  };

  const toggleQueue = (id: string) => {
    setQueue((q) => (q.includes(id) ? q.filter((x) => x !== id) : [...q, id]));
  };

  return (
    <>
      <div className={'clock' + (yourTurn ? ' is-yours' : '')}>
        <div className="clock-read">
          <div>
            <p className="eyebrow">Pick</p>
            <p className="clock-pick">{label(pick, teams)}</p>
          </div>
          <div className="clock-team">
            <p className="eyebrow">{assistant ? 'Waiting on' : 'On the clock'}</p>
            <p className="clock-who" style={yourTurn ? { color: 'var(--gold)' } : undefined}>
              {onClock
                ? maskTeam(onClock.name, onClock.index, onClock.isUser, anonymous)
                : 'Draft complete'}
            </p>
          </div>

          <div className="clock-next">
            <p className="eyebrow">Your next pick</p>
            <p className="clock-who">
              {oddsTarget == null ? 'None left' : label(oddsTarget, teams)}
              {away != null && away > 0 && (
                <span className="hint" style={{ marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
                  {away === 1 ? '1 pick away' : away + ' picks away'}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="clock-acts">
          {assistant ? (
            <>
              <span className={'live-dot' + (liveError ? ' is-down' : '')}>
                <span className="on-wide">
                  {liveError ? 'Sleeper not answering' : 'Following live'}
                </span>
                <span className="on-narrow">{liveError ? 'No answer' : 'Live'}</span>
              </span>
              <button type="button" className="btn" onClick={() => setPaused((p) => !p)}>
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button type="button" className="btn is-quiet act-settings" onClick={onLeave}>
                Settings
              </button>
            </>
          ) : (
            <>
              {yourTurn && (
                <button type="button" className="btn is-primary" onClick={takeBest}>
                  <span className="on-wide">
                    {queue.length ? 'Take top of queue' : 'Take best available'}
                  </span>
                  <span className="on-narrow">{queue.length ? 'Take queued' : 'Take best'}</span>
                </button>
              )}
              {!yourTurn && !state.done && (
                <button type="button" className="btn" onClick={() => setPaused((p) => !p)}>
                  {paused ? 'Resume' : 'Pause'}
                </button>
              )}
              <button
                type="button"
                className="btn"
                disabled={!state.picks.length}
                onClick={() => onEngine(undoToMyLastPick(engine))}
              >
                <span className="on-wide">Undo my pick</span>
                <span className="on-narrow">Undo</span>
              </button>
              <button
                type="button"
                className="btn is-quiet"
                onClick={() => onEngine(autoDraftRest(engine))}
              >
                <span className="on-wide">Simulate to the end</span>
                <span className="on-narrow">Sim</span>
              </button>
              <button
                type="button"
                className="btn is-quiet act-settings"
                onClick={onLeave}
                aria-label="Back to settings"
              >
                <span className="on-wide">Settings</span>
                <span className="on-narrow" aria-hidden="true">⚙</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="tabs">
        {(['pool', 'board', 'roster'] as Pane[]).map((p) => (
          <button key={p} type="button" aria-pressed={pane === p} onClick={() => setPane(p)}>
            {p === 'pool' ? 'Players' : p === 'board' ? 'Board' : 'My team'}
          </button>
        ))}
      </div>

      <div className="stage">
        <div className={'panel pool-col' + (pane === 'pool' ? ' is-active' : '')}>
          <div className="panel-head">
            <h2 className="eyebrow">
              {available.length + ' available'}
            </h2>
            <span className="hint">
              {board.meta.formatLabel + ' · ' + board.meta.adpSourceLabel}
              {assistant && liveAt
                ? ' · read ' + Math.max(0, Math.round((Date.now() - liveAt) / 1000)) + 's ago'
                : ''}
            </span>
          </div>

          {assistant && unknownPicks > 0 && (
            <p className="hint" style={{ padding: '6px 12px', color: 'var(--te)' }}>
              {unknownPicks + ' real pick' + (unknownPicks === 1 ? ' is' : 's are')
                + ' of players this board does not hold, so those slots read as open.'}
            </p>
          )}
          <PlayerPool
            players={available}
            myRank={myRank}
            notes={notes}
            currentPick={pick}
            myNextPick={oddsTarget}
            teams={teams}
            onDraft={draft}
            canDraft={yourTurn}
            queue={queue}
            onQueue={toggleQueue}
            formatLabel={board.meta.formatLabel}
          />
        </div>

        <div className={'panel board-col' + (pane === 'board' ? ' is-active' : '')}>
          <div className="panel-head">
            <h2 className="eyebrow">The board</h2>
            <span className="hint">
              {state.picks.length + ' of ' + state.order.length + ' picks made'}
            </span>
          </div>
          <DraftBoard engine={engine} currentPick={pick} anonymous={anonymous} />
        </div>

        <div className={'panel roster-col' + (pane === 'roster' ? ' is-active' : '')}>
          <RosterPanel
            players={myPlayers}
            roster={state.league.roster}
            title="Your team"
            keptIds={keptIds}
          />
        </div>
      </div>
    </>
  );
}
