import { useMemo, useState } from 'react';
import { PRESETS, describeBias } from '../engine/cpu';
import { STARTER_SLOTS, rosterSize, starterCount } from '../engine/roster';
import AssistantPanel from './AssistantPanel';
import KeepersPanel from './KeepersPanel';
import LeaguePanel from './LeaguePanel';
import NotesPanel from './NotesPanel';
import RankingsPanel from './RankingsPanel';
import ResumePanel from './ResumePanel';
import Section from './Section';
import useNarrow from '../useNarrow';
import { maskLeague } from '../anon';
import type {
  AppMode, Board, CpuConfig, LeagueConfig, LeagueImport, LeagueSetup, NoteSet,
  Overrides, PendingKeeper, Position, PresetPick, RankingSet, RosterSlots, SavedLeague,
} from '../engine/types';
import { POSITIONS } from '../engine/types';

const SCORING = [
  { id: 'half-ppr', label: 'Half PPR' },
  { id: 'ppr', label: 'PPR' },
  { id: 'standard', label: 'Standard' },
  { id: '2qb', label: 'Superflex / 2QB' },
  { id: 'dynasty', label: 'Dynasty' },
];

const ADP_SOURCES = [
  { id: 'sleeper', label: 'Sleeper, then Fantasy Football Calculator' },
  { id: 'ffc', label: 'Fantasy Football Calculator, then Sleeper' },
  { id: 'blend', label: 'The mean of both' },
];

const DRAFT_TYPES = [
  { id: 'snake', label: 'Snake' },
  { id: 'linear', label: 'Linear' },
  { id: 'third-round-reversal', label: 'Third round reversal' },
];

const PACES = [
  { value: 0, label: 'Instant' },
  { value: 140, label: 'Fast' },
  { value: 500, label: 'Watchable' },
];

const SLOT_LABEL: Record<string, string> = {
  QB: 'Quarterback', RB: 'Running back', WR: 'Receiver', TE: 'Tight end',
  FLEX: 'Flex (RB/WR/TE)', SUPERFLEX: 'Superflex (+QB)', K: 'Kicker', DEF: 'Defence',
  BENCH: 'Bench',
};

interface Props {
  league: LeagueConfig;
  cpu: CpuConfig;
  preset: string;
  pace: number;
  board: Board | null;
  loading: boolean;
  error: string | null;
  rankings: RankingSet | null;
  overrides: Overrides;
  rankingsBusy: boolean;
  noteSet: NoteSet | null;
  notesBusy: boolean;
  onNotes: (csv: string, label: string) => void;
  onClearNotes: () => void;
  savedLeagues: SavedLeague[];
  activeLeagueId: string | null;
  importedLeague: LeagueImport | null;
  leagueBusy: boolean;
  leagueError: string | null;
  onLeague: (next: LeagueConfig) => void;
  onCpu: (next: CpuConfig, preset: string) => void;
  onPace: (next: number) => void;
  onRankings: (csv: string, label: string) => void;
  onOverride: (key: string, playerId: string | null) => void;
  onForgetOverride: (key: string) => void;
  onRankColumn: (index: number) => void;
  onClearRankings: () => void;
  onLoadSleeperLeague: (id: string) => void;
  onAddSleeperLeague: (id: string) => void;
  onRefreshSleeperLeague: (id: string) => void;
  onRemoveSleeperLeague: (id: string) => void;
  onStart: () => void;
  onRefreshBoard: () => void;

  mode: AppMode;
  onMode: (mode: AppMode) => void;
  anonymous: boolean;
  leagueLabel: string;

  keepers: PresetPick[];
  pendingKeepers: PendingKeeper[];
  onKeeperRound: (playerId: string, round: number) => void;
  onDropPending: (playerId: string) => void;
  onAddKeeper: (pick: PresetPick) => void;
  onRemoveKeeper: (overall: number) => void;
  onClearKeepers: () => void;
  onImportKeepers: () => void;
  keeperImportBusy: boolean;
  keeperImportNote: string | null;
  canImport: boolean;
  declared: number;

  resumeLive: boolean;
  onResumeLive: (on: boolean) => void;
  liveCount: { picks: number; at: number } | null;
  liveBusy: boolean;
  liveStarted: boolean;
  hasDraft: boolean;
  startError: string | null;
  onCheckLive: () => void;

  setup: LeagueSetup | null;
  myUserId: string | null;
  onMyUser: (userId: string) => void;
  onCheckDraft: () => void;
}

function Stepper(props: {
  value: number; min: number; max: number; onChange: (n: number) => void; label: string;
}) {
  const { value, min, max, onChange, label } = props;
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={'One fewer ' + label}>&minus;</button>
      <output>{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={'One more ' + label}>+</button>
    </div>
  );
}

export default function SetupScreen(props: Props) {
  const {
    league, cpu, preset, pace, board, loading, error, rankings, overrides, rankingsBusy,
    noteSet, notesBusy, onNotes, onClearNotes,
    savedLeagues, activeLeagueId, importedLeague, leagueBusy, leagueError,
    onLeague, onCpu, onPace, onRankings, onOverride, onForgetOverride, onRankColumn,
    onClearRankings, onLoadSleeperLeague, onAddSleeperLeague, onRefreshSleeperLeague,
    onRemoveSleeperLeague, onStart, onRefreshBoard,
    mode, onMode, anonymous, leagueLabel,
    keepers, pendingKeepers, onKeeperRound, onDropPending,
    onAddKeeper, onRemoveKeeper, onClearKeepers, onImportKeepers,
    keeperImportBusy, keeperImportNote, canImport, declared,
    resumeLive, onResumeLive, liveCount, liveBusy, liveStarted, hasDraft, startError,
    onCheckLive,
    setup, myUserId, onMyUser, onCheckDraft,
  } = props;

  const activeLeague = savedLeagues.find((l) => l.id === activeLeagueId) || null;
  const assistant = mode === 'assistant';
  const canFollow = assistant && !!importedLeague?.draftId && !!myUserId;

  // On a phone the sections close, and each states what it is set to on its own
  // row. On a desktop they are all open, because all of them fit.
  const narrow = useNarrow();

  const [roundsLocked, setRoundsLocked] = useState(false);

  const total = rosterSize(league.roster);
  const starters = starterCount(league.roster);

  const setRoster = (slot: keyof RosterSlots, n: number) => {
    const roster = { ...league.roster, [slot]: Math.max(0, n) };
    onLeague({ ...league, roster, rounds: roundsLocked ? league.rounds : rosterSize(roster) });
  };

  const setBias = (pos: Position, level: number) => {
    onCpu({ ...cpu, positionBias: { ...cpu.positionBias, [pos]: level } }, 'custom');
  };

  const superflexMismatch = league.roster.SUPERFLEX > 0 && league.scoring !== '2qb';
  const shortDraft = league.rounds < starters;

  // A draft cannot make more picks than the board holds players. Standard
  // scoring publishes the shallowest board of the five, so a deep league can
  // outrun it. Better to say so here than to run out in round twenty two.
  const picks = league.teams * league.rounds;
  const outrunsBoard = !!board && picks > board.meta.poolSize;

  const summary = useMemo(() => {
    if (!board) return null;
    const counts = POSITIONS.map((p) => p + ' ' + (board.meta.positionCounts[p] || 0)).join('  ');
    return { counts };
  }, [board]);

  const scoringWord = SCORING.find((s) => s.id === league.scoring)?.label ?? league.scoring;

  /**
   * What each closed section is set to.
   *
   * A row of drawers labelled only by name makes you open every one of them to
   * learn anything, which is the scrolling this was meant to end. Each of these
   * is the one reading you would have opened the section to check.
   */
  /** How many notes arrived inside the ranking file rather than on their own. */
  const notesFromRankings = rankings?.entries.filter((e) => e.note).length ?? 0;

  const states = {
    leagues: activeLeague
      ? maskLeague(activeLeague.name, savedLeagues.indexOf(activeLeague), anonymous)
      : 'none loaded',
    league: league.teams + ' × ' + league.rounds + ' · ' + scoringWord,
    roster: starters + ' start · ' + league.roster.BENCH + ' bench',
    room: PRESETS.find((p) => p.id === preset)?.name ?? 'Custom',
    keepers: (keepers.length ? keepers.length + ' entered' : 'none entered')
      + (pendingKeepers.length ? ' · ' + pendingKeepers.length + ' need a round' : ''),
    rankings: rankings ? rankings.entries.length + ' matched' : 'ADP order',
    notes: (() => {
      const total = notesFromRankings + (noteSet?.notes.length ?? 0);
      return total ? total + ' on the board' : 'none';
    })(),
  };

  return (
    <>
    <div className="setup">
      <div className="setup-inner">
        <header className="setup-lede span-2">
          <div>
            <p className="eyebrow">
              {assistant ? 'Live draft assistant' : 'Mock draft simulator'}
            </p>
            <h1>
              {assistant ? 'Read the room' : 'Run the room'}
              <br />
              <em>{assistant ? 'while it drafts' : 'before it runs you'}</em>
            </h1>

            {/*
              * Two jobs, one board. A mock invents a room to draft against. The
              * assistant invents nothing and mirrors the draft you are in.
              */}
            <div className="mode-switch" role="group" aria-label="What this run is">
              <button
                type="button"
                aria-pressed={mode === 'mock'}
                onClick={() => onMode('mock')}
              >
                Mock draft
                <span>a simulated room</span>
              </button>
              <button
                type="button"
                aria-pressed={assistant}
                onClick={() => onMode('assistant')}
              >
                Draft assistant
                <span>follows your real draft</span>
              </button>
            </div>
          </div>
          <div className="lede-side">
            {board && !loading && (
              <p className="hint" style={{ textAlign: 'right', maxWidth: '46ch' }}>
                {board.meta.poolSize + ' players'}
                {board.meta.totalDrafts
                  ? ', off ' + board.meta.totalDrafts.toLocaleString() + ' real drafts'
                  : ''}
                {board.meta.window ? ' between ' + board.meta.window : ''}
                .
                {summary ? ' ' + summary.counts + '.' : ''}
              </p>
            )}
            {loading && <p className="hint">Loading the board.</p>}
            <div className="lede-acts">
              <button type="button" className="btn is-quiet" onClick={onRefreshBoard} disabled={loading}>
                Refresh ADP
              </button>
              <button
                type="button"
                className="btn is-primary"
                onClick={onStart}
                disabled={!board || loading || (assistant && !canFollow)}
                title={assistant && !canFollow
                  ? 'Choose a league with a draft, and say which manager is you'
                  : undefined}
              >
                {assistant ? 'Follow the draft' : 'Start mock draft'}
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="banner is-bad span-2">
            <span>
              <b>The board did not load.</b>
              {' '}
              {error}
              {' Start the data service with '}
              <code className="mono">npm run dev</code>
              {' from the project root, then press Refresh ADP.'}
            </span>
          </div>
        )}

        {outrunsBoard && board && (
          <div className="banner is-bad span-2">
            <span>
              <b>{'This draft makes ' + picks + ' picks and the board holds '
                + board.meta.poolSize + ' players.'}</b>
              {' The last rounds will run dry. Cut the rounds or the teams, or switch to a '
                + 'scoring format with a deeper board. Half PPR is the deepest.'}
            </span>
          </div>
        )}

        {board?.meta.stale && (
          <div className="banner span-2">
            <span>
              Working from a cached board. The ADP feeds did not answer, so these numbers are the
              last set that came through.
            </span>
          </div>
        )}

        <Section
          title="Your Sleeper leagues"
          summary={states.leagues}
          note="One click sets the teams, rounds, roster and scoring. Settings are kept, not
            re-read."
          wide
          collapsible={narrow}
          startOpen
        >
          <LeaguePanel
            leagues={savedLeagues}
            activeId={activeLeagueId}
            imported={importedLeague}
            busy={leagueBusy}
            error={leagueError}
            onLoad={onLoadSleeperLeague}
            onAdd={onAddSleeperLeague}
            onRefresh={onRefreshSleeperLeague}
            onRemove={onRemoveSleeperLeague}
            anonymous={anonymous}
            setup={setup}
            myUserId={myUserId}
            onMyUser={onMyUser}
          />
        </Section>

        {assistant && (
          <AssistantPanel
            league={activeLeague}
            setup={setup}
            myUserId={myUserId}
            busy={leagueBusy}
            error={leagueError}
            onRefresh={onCheckDraft}
            leagueLabel={leagueLabel}
          />
        )}

        {/* ------------------------------------------------------------ league */}
        <Section title="The league" summary={states.league} collapsible={narrow}>
          <>
            <div className="grid-3">
              <div className="field">
                <label htmlFor="teams">Teams</label>
                <select
                  id="teams"
                  className="input"
                  value={league.teams}
                  onChange={(e) => {
                    const teams = Number(e.target.value);
                    onLeague({ ...league, teams, mySlot: Math.min(league.mySlot, teams) });
                  }}
                >
                  {Array.from({ length: 15 }, (_, i) => i + 2).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="slot">Your slot</label>
                <select
                  id="slot"
                  className="input"
                  value={league.mySlot}
                  onChange={(e) => onLeague({ ...league, mySlot: Number(e.target.value) })}
                >
                  {Array.from({ length: league.teams }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="rounds">Rounds</label>
                <select
                  id="rounds"
                  className="input"
                  value={league.rounds}
                  onChange={(e) => {
                    setRoundsLocked(true);
                    onLeague({ ...league, rounds: Number(e.target.value) });
                  }}
                >
                  {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label htmlFor="scoring">Scoring</label>
                <select
                  id="scoring"
                  className="input"
                  value={league.scoring}
                  onChange={(e) => onLeague({ ...league, scoring: e.target.value })}
                >
                  {SCORING.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="draftType">Order</label>
                <select
                  id="draftType"
                  className="input"
                  value={league.draftType}
                  onChange={(e) => onLeague({ ...league, draftType: e.target.value as LeagueConfig['draftType'] })}
                >
                  {DRAFT_TYPES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="adpSource">Which ADP</label>
              <select
                id="adpSource"
                className="input"
                value={league.adpSource}
                onChange={(e) => onLeague({ ...league, adpSource: e.target.value })}
              >
                {ADP_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <p className="hint">
                Sleeper ranks about twice as many players, so the late rounds stay real. Fantasy
                Football Calculator publishes a separate ADP for every league size and measures how
                far real drafts disagree on each player, which is what sets the reaching.
                {board && board.meta.requestedLeagueSize !== board.meta.adpLeagueSize
                  && ' Your ' + board.meta.requestedLeagueSize + ' team league reads the '
                    + board.meta.adpLeagueSize + ' team ADP, the nearest one published.'}
              </p>
            </div>

            <div className="field">
              <label htmlFor="pace">Pace</label>
              <select
                id="pace"
                className="input"
                value={pace}
                onChange={(e) => onPace(Number(e.target.value))}
              >
                {PACES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </>
        </Section>

        {/* ------------------------------------------------------------ roster */}
        <Section title="Roster" summary={states.roster} collapsible={narrow}>
          <>
            <div>
              {[...STARTER_SLOTS, 'BENCH' as const].map((slot) => (
                <div className="slot-row" key={slot}>
                  <span className="slot-name">{SLOT_LABEL[slot]}</span>
                  <Stepper
                    label={SLOT_LABEL[slot]}
                    value={league.roster[slot]}
                    min={0}
                    max={slot === 'BENCH' ? 20 : 8}
                    onChange={(n) => setRoster(slot, n)}
                  />
                </div>
              ))}
            </div>

            {total !== league.rounds && (
              <p className="hint">
                {'The roster holds ' + total + ' players and the draft runs ' + league.rounds
                  + ' rounds. '}
                <button
                  type="button"
                  className="btn is-quiet"
                  style={{ padding: '2px 8px' }}
                  onClick={() => { setRoundsLocked(false); onLeague({ ...league, rounds: total }); }}
                >
                  Match them
                </button>
              </p>
            )}

            {shortDraft && (
              <div className="banner is-bad">
                <span>
                  {'The draft is shorter than the starting lineup. Every team will finish '
                    + (starters - league.rounds) + ' starters short.'}
                </span>
              </div>
            )}

            {superflexMismatch && (
              <div className="banner">
                <span>
                  <b>Superflex needs superflex ADP.</b>
                  {' On a '}
                  {SCORING.find((s) => s.id === league.scoring)?.label}
                  {' board quarterbacks are cheap, because in those leagues they are. Switch '
                    + 'scoring to Superflex / 2QB or the room will let every quarterback fall.'}
                </span>
              </div>
            )}
          </>
        </Section>

        {/* --------- the room. A mock invents it; the assistant does not ---- */}
        {!assistant && (
        <Section
          title="How the room drafts"
          summary={states.room}
          note="Every setting moves players by a number of picks."
          wide
          collapsible={narrow}
        >
          <>
            <div className="preset-row">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="preset"
                  aria-pressed={preset === p.id}
                  title={p.blurb}
                  onClick={() => onCpu({ ...p.cpu, positionBias: { ...p.cpu.positionBias }, cpuUsesMyRankings: cpu.cpuUsesMyRankings }, p.id)}
                >
                  {p.name}
                </button>
              ))}
              {preset === 'custom' && <button type="button" className="preset" aria-pressed>Custom</button>}
            </div>
            <p className="hint">
              {PRESETS.find((p) => p.id === preset)?.blurb
                ?? 'Your own settings. Pick a preset above to start over.'}
            </p>

            <div className="grid-2">
              <div className="dial is-wide">
                <div className="dial-top">
                  <span className="slot-name">Reach</span>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={cpu.randomness}
                    aria-label="How far the room reaches from ADP"
                    onChange={(e) => onCpu({ ...cpu, randomness: Number(e.target.value) }, 'custom')}
                  />
                  <span className="dial-value">{cpu.randomness}</span>
                </div>
                <p className="hint">
                  {cpu.randomness === 0 && 'The board goes in exact order. Nobody reaches for anybody.'}
                  {cpu.randomness > 0 && cpu.randomness < 3 && 'Tighter than real drafts. Shows the earliest a player can fall to you.'}
                  {cpu.randomness === 3 && 'Matches real drafts. Each player moves by the spread measured across thousands of them.'}
                  {cpu.randomness > 3 && cpu.randomness <= 6 && 'Looser than real drafts. Runs start sooner and go further.'}
                  {cpu.randomness > 6 && 'Well past what real drafts do. Round one shuffles.'}
                </p>
              </div>

              <div className="dial is-wide">
                <div className="dial-top">
                  <span className="slot-name">Roster need</span>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={cpu.needWeight}
                    aria-label="How much the room drafts for roster need"
                    onChange={(e) => onCpu({ ...cpu, needWeight: Number(e.target.value) }, 'custom')}
                  />
                  <span className="dial-value">{cpu.needWeight}</span>
                </div>
                <p className="hint">
                  {cpu.needWeight === 0 && 'Pure board. Teams take the best player left, finish with holes, and draft kickers by ADP.'}
                  {cpu.needWeight > 0 && cpu.needWeight < 5 && 'A light lean toward open starting slots.'}
                  {cpu.needWeight === 5 && 'Balanced. Teams fill open starting slots first and leave the kicker until the end.'}
                  {cpu.needWeight > 5 && 'Teams chase open slots hard and stop taking depth early.'}
                </p>
              </div>
            </div>

            <div>
              <p className="eyebrow" style={{ margin: '4px 0 2px' }}>
                Position weight, against ADP
              </p>
              <div className="grid-2">
                {POSITIONS.map((pos) => (
                  <div className="dial" key={pos} data-pos={pos}>
                    <div className="dial-top">
                      <span className="pos-tag">{pos}</span>
                      <input
                        type="range"
                        min={-5}
                        max={5}
                        step={1}
                        value={cpu.positionBias[pos]}
                        aria-label={pos + ' weight against ADP'}
                        onChange={(e) => setBias(pos, Number(e.target.value))}
                      />
                      <span className="dial-value" data-zero={cpu.positionBias[pos] === 0}>
                        {cpu.positionBias[pos] > 0 ? '+' : ''}
                        {cpu.positionBias[pos]}
                      </span>
                    </div>
                    <p className="hint">{describeBias(cpu.positionBias[pos])}</p>
                  </div>
                ))}
              </div>
            </div>

            <label
              className="hint"
              style={{
                display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer',
                borderTop: '1px solid var(--line-soft)', paddingTop: 12,
              }}
            >
              <input
                type="checkbox"
                checked={cpu.cpuUsesMyRankings}
                disabled={!rankings}
                onChange={(e) => onCpu({ ...cpu, cpuUsesMyRankings: e.target.checked }, preset)}
              />
              <span>
                <b style={{ color: 'var(--chalk-2)' }}>The room drafts from my rankings too.</b>
                {rankings
                  ? ' Off by default: the point of a mock draft is that the room disagrees with you.'
                  : ' Upload a ranking list first.'}
              </span>
            </label>
          </>
        </Section>
        )}

        {/*
          * Keepers only show for a league that actually keeps players. In the
          * other leagues the panel is a foot-gun: an entry here silently fixes
          * a pick, and nothing about a redraft league ever needs that.
          */}
        {!assistant && (
          <Section
            title="Start from the live draft"
            summary={resumeLive
              ? (liveCount ? liveCount.picks + ' picks in' : 'on')
              : 'from pick one'}
            wide
            collapsible={narrow}
            startOpen={resumeLive}
          >
            <ResumePanel
              started={liveStarted}
              hasDraft={hasDraft}
              on={resumeLive}
              onChange={onResumeLive}
              picks={liveCount}
              total={league.teams * league.rounds}
              busy={liveBusy}
              error={startError}
              onCheck={onCheckLive}
              leagueLabel={leagueLabel}
            />
          </Section>
        )}

        {!assistant && !!importedLeague?.isKeeper && (
          <Section
            title="Keepers"
            summary={states.keepers}
            wide
            collapsible={narrow}
            startOpen={keepers.length === 0 || pendingKeepers.length > 0}
          >
            <KeepersPanel
              league={league}
              board={board?.players ?? []}
              keepers={keepers}
              pending={pendingKeepers}
              onKeeperRound={onKeeperRound}
              onDropPending={onDropPending}
              maxKeepers={importedLeague?.maxKeepers ?? 0}
              canImport={canImport}
              declared={declared}
              anonymous={anonymous}
              importing={keeperImportBusy}
              importNote={keeperImportNote}
              onAdd={onAddKeeper}
              onRemove={onRemoveKeeper}
              onClear={onClearKeepers}
              onImport={onImportKeepers}
            />
          </Section>
        )}

        <Section
          title="Your rankings"
          summary={rankings
            ? states.rankings + (rankings.unmatched.length
              ? ' · ' + rankings.unmatched.length + ' need you'
              : '')
            : states.rankings}
          wide
          collapsible={narrow}
        >
          <RankingsPanel
            board={board?.players ?? []}
            rankings={rankings}
            overrides={overrides}
            busy={rankingsBusy || loading}
            onLoad={onRankings}
            onOverride={onOverride}
            onForget={onForgetOverride}
            onRankColumn={onRankColumn}
            onClear={onClearRankings}
          />
        </Section>

        <Section
          title="Your notes"
          summary={states.notes}
          wide
          collapsible={narrow}
        >
          <NotesPanel
            notes={noteSet}
            fromRankings={notesFromRankings}
            busy={notesBusy || loading}
            onLoad={onNotes}
            onClear={onClearNotes}
          />
        </Section>

        <footer className="setup-footer">
          <p className="hint">
            ADP comes from
            {' '}
            <a href="https://fantasyfootballcalculator.com" target="_blank" rel="noreferrer" style={{ color: 'var(--chalk-2)' }}>
              Fantasy Football Calculator
            </a>
            {' and from '}
            <a href="https://sleeper.com" target="_blank" rel="noreferrer" style={{ color: 'var(--chalk-2)' }}>
              Sleeper
            </a>
            . Season projections come from Rotowire through Sleeper. Both feeds are free and
            neither needs a key. Nothing you set here leaves this browser.
          </p>
        </footer>
      </div>
    </div>

    {/*
      * THE RAIL
      *
      * On a phone the settings are a scroll and the one button you came for was
      * at the top of it, gone the moment you touched anything. It lives down
      * here instead, where the thumb already is, and it never leaves. The line
      * above it is the draft you are about to run, read back in the same terms
      * the board uses: seats, rounds, scoring.
      */}
    <div className="start-rail">
      <p className="start-read mono">
        {league.teams + ' × ' + league.rounds + ' · ' + scoringWord + ' · seat ' + league.mySlot}
        {keepers.length ? ' · ' + keepers.length + ' kept' : ''}
      </p>
      <button
        type="button"
        className="btn is-primary"
        onClick={onStart}
        disabled={!board || loading || (assistant && !canFollow)}
      >
        {assistant ? 'Follow the draft' : 'Start mock draft'}
      </button>
      {assistant && !canFollow && (
        <p className="hint start-block">
          Choose a league with a draft, and say which manager is you.
        </p>
      )}
    </div>
    </>
  );
}
