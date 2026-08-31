import { useRef, useState } from 'react';
import PlayerPicker from './PlayerPicker';
import type { Overrides, Player, RankingSet } from '../engine/types';

interface Props {
  board: Player[];
  rankings: RankingSet | null;
  overrides: Overrides;
  busy: boolean;
  onLoad: (csv: string, label: string) => void;
  onOverride: (key: string, playerId: string | null) => void;
  onForget: (key: string) => void;
  onRankColumn: (index: number) => void;
  onClear: () => void;
}

const TIER_WORDS: Record<string, string> = {
  override: 'your own mapping',
  exact: 'an exact match',
  name: 'the name alone',
  team: 'the surname, position and team',
  nickname: 'a short form of the first name',
  loose: 'the name alone, with no position to check against',
};

export default function RankingsPanel(props: Props) {
  const {
    board, rankings, overrides, busy, onLoad, onOverride, onForget, onRankColumn, onClear,
  } = props;

  const [pasted, setPasted] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => onLoad(String(reader.result || ''), file.name);
    reader.readAsText(file);
  };

  const inexact = rankings?.entries.filter((e) => e.matchedBy !== 'exact') ?? [];
  const unmatched = rankings?.unmatched ?? [];
  const ignored = rankings?.ignored ?? [];

  return (
    <>
    {!rankings && (
      <>
        <p className="hint">
          Drop in a CSV from anywhere. The columns are detected, so a header row of Player,
          Pos, Team, Rank, Tier works and so does a bare list of names, one per line, best
          first. Your rankings drive your board and the value column. The room keeps drafting
          to market ADP unless you tell it otherwise above.
        </p>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="file">Upload a file</label>
            <input
              id="file"
              ref={fileRef}
              className="input"
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="paste">Or paste it</label>
            <textarea
              id="paste"
              className="input"
              rows={4}
              value={pasted}
              placeholder={'Player,Pos,Team,Rank\nJa’Marr Chase,WR,CIN,1'}
              onChange={(e) => setPasted(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={!pasted.trim() || busy}
              onClick={() => onLoad(pasted, 'Pasted list')}
            >
              Match these
            </button>
          </div>
        </div>
      </>
    )}

    {rankings && (
      <>
        <div className="grid-2">
          <div>
            <p className="eyebrow">Loaded</p>
            <p style={{ margin: '2px 0 0' }}>{rankings.label}</p>

            {/*
              * Which column holds the ranking is the one thing that decides
              * whether your board is yours. A real export can carry six
              * columns with "rank" in the name and only one of them is the
              * ranking, so the chosen column is shown and can be changed.
              */}
            {rankings.columns.headers.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <span className="hint" style={{ whiteSpace: 'nowrap' }}>Rank column</span>
                <select
                  className="input"
                  style={{ maxWidth: 230 }}
                  aria-label="Which column holds the ranking"
                  value={rankings.columns.rankIndex}
                  disabled={busy}
                  onChange={(e) => onRankColumn(Number(e.target.value))}
                >
                  {rankings.columns.headers.map((h, i) => (
                    <option key={h + i} value={i}>{h || 'column ' + (i + 1)}</option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="hint">
                No header row, so the line order is the rank.
              </p>
            )}

            <p className="hint" style={{ marginTop: 6 }}>
              {rankings.columns.position
                ? 'Position read from ' : 'No position column found. '}
              {rankings.columns.position
                ? <code className="mono">{rankings.columns.position}</code>
                : null}
              {rankings.columns.position ? '. ' : ''}
              {rankings.duplicates
                ? rankings.duplicates + ' rows named a player already in the list and were dropped.'
                : ''}
            </p>
          </div>
          <div style={{ justifySelf: 'end', alignSelf: 'center', display: 'flex', gap: 6 }}>
            <input
              className="input"
              style={{ display: 'none' }}
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file);
              }}
            />
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              Load another
            </button>
            <button type="button" className="btn is-quiet" onClick={onClear}>
              Remove
            </button>
          </div>
        </div>

        {/* ---------------------------------------- names that found nobody */}
        {unmatched.length > 0 && (
          <div>
            <div className="banner">
              <span>
                <b>
                  {unmatched.length === 1
                    ? 'One name found no player.'
                    : unmatched.length + ' names found no player.'}
                </b>
                {unmatched.length === 1
                  ? ' Map it once and the mapping is kept. Every list you load after this uses '
                    + 'it, so you will not be asked again.'
                  : ' Map each one once and the mapping is kept. Every list you load after this '
                    + 'uses them, so you will not be asked again.'}
              </span>
            </div>

            <div className="resolve-list">
              {unmatched.map((u) => (
                <div className="resolve" key={u.key}>
                  <div className="resolve-name">
                    <b>{u.name}</b>
                    <span className="hint">
                      {[u.position, u.team].filter(Boolean).join(' · ') || 'no position given'}
                      {' · your rank ' + u.rank}
                    </span>
                  </div>
                  <PlayerPicker
                    board={board}
                    suggestions={u.suggestions}
                    value={draft[u.key] ?? null}
                    label={'Which player is ' + u.name}
                    onChange={(id) => setDraft((d) => ({ ...d, [u.key]: id }))}
                  />
                  <div className="resolve-acts">
                    <button
                      type="button"
                      className="btn is-primary"
                      disabled={!draft[u.key] || busy}
                      onClick={() => {
                        onOverride(u.key, draft[u.key]!);
                        setDraft((d) => {
                          const next = { ...d };
                          delete next[u.key];
                          return next;
                        });
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn is-quiet"
                      disabled={busy}
                      title="Keep this name out of your board and stop asking about it"
                      onClick={() => onOverride(u.key, null)}
                    >
                      Leave it out
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ------------------------------------ matches that were not exact */}
        {inexact.length > 0 && (
          <div>
            <button
              type="button"
              className="btn is-quiet"
              aria-expanded={showReview}
              onClick={() => setShowReview((v) => !v)}
            >
              {(showReview ? 'Hide the ' : 'Review the ') + inexact.length
                + ' match' + (inexact.length === 1 ? '' : 'es') + ' that were not exact'}
            </button>

            {showReview && (
              <div className="resolve-list">
                {inexact.map((e) => (
                  <div className="resolve" key={e.overrideKey}>
                    <div className="resolve-name">
                      <b>{e.sourceName}</b>
                      <span className="hint">
                        {'became '}
                        <span style={{ color: 'var(--chalk-2)' }}>{e.name}</span>
                        {', on ' + (TIER_WORDS[e.matchedBy] || e.matchedBy)}
                      </span>
                    </div>
                    <PlayerPicker
                      board={board}
                      suggestions={[]}
                      value={draft[e.overrideKey] ?? e.id}
                      label={'Which player is ' + e.sourceName}
                      onChange={(id) => setDraft((d) => ({ ...d, [e.overrideKey]: id }))}
                    />
                    <div className="resolve-acts">
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || !draft[e.overrideKey] || draft[e.overrideKey] === e.id}
                        onClick={() => onOverride(e.overrideKey, draft[e.overrideKey]!)}
                      >
                        Correct it
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------- names you left out */}
        {ignored.length > 0 && (
          <p className="hint">
            {'Left out on purpose: '}
            {ignored.map((i, n) => (
              <span key={i.key}>
                {n > 0 ? ', ' : ''}
                <button
                  type="button"
                  className="link"
                  onClick={() => onForget(i.key)}
                  title={'Ask about ' + i.name + ' again'}
                >
                  {i.name}
                </button>
              </span>
            ))}
            .
          </p>
        )}

        <p className="hint">
          {'Matched on: '}
          {Object.entries(rankings.tiers)
            .sort((a, b) => b[1] - a[1])
            .map(([tier, n]) => n + ' by ' + (TIER_WORDS[tier] || tier))
            .join(', ')}
          .
          {Object.keys(overrides).length === 1
            ? ' One name mapping of yours is saved and applies to every list you load.'
            : ''}
          {Object.keys(overrides).length > 1
            ? ' ' + Object.keys(overrides).length
              + ' name mappings of yours are saved and apply to every list you load.'
            : ''}
        </p>
      </>
    )}
    </>
  );
}
