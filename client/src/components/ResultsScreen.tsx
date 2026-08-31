import { useMemo } from 'react';
import { maskTeam } from '../anon';
import type { DraftEngine } from '../engine/draft';
import { biggestSteals, gradeDraft } from '../engine/grade';
import RosterPanel from './RosterPanel';
import { POSITIONS } from '../engine/types';

interface Props {
  engine: DraftEngine;
  anonymous: boolean;
  onRestart: () => void;
  onNewSettings: () => void;
}

function gain(n: number) {
  const rounded = Math.round(n);
  return (
    <span className={rounded >= 0 ? 'gain-pos' : 'gain-neg'}>
      {rounded > 0 ? '+' : ''}
      {rounded}
    </span>
  );
}

export default function ResultsScreen({
  engine, anonymous, onRestart, onNewSettings,
}: Props) {
  const seat = (t: { name: string; index: number; isUser: boolean }) => maskTeam(
    t.name, t.index, t.isUser, anonymous,
  );
  const results = useMemo(() => gradeDraft(engine), [engine]);
  const steals = useMemo(() => biggestSteals(engine, 6), [engine]);
  const mine = results.find((r) => r.team.isUser)!;
  const ordered = [...results].sort((a, b) => a.rank - b.rank);
  const { teams, roster } = engine.state.league;

  const valueRank = [...results].sort((a, b) => b.value - a.value)
    .findIndex((r) => r.team.isUser) + 1;

  // Where the team finished, in thirds. Drives the one colour that judges.
  const band = mine.rank <= teams / 3 ? 'top'
    : mine.rank > (teams * 2) / 3 ? 'bottom' : 'middle';

  return (
    <div className="results">
      <div className="results-inner">
        <section className="panel verdict">
          <div>
            <p className="eyebrow">Your draft</p>
            <div className="verdict-grade" data-band={band}>{mine.grade}</div>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="stat-row">
              <div>
                <span className="eyebrow">Starting points</span>
                <b>{Math.round(mine.points)}</b>
                <span className="hint">{'Rank ' + mine.rank + ' of ' + teams}</span>
              </div>
              <div>
                <span className="eyebrow">Picks gained on ADP</span>
                <b>{gain(mine.value)}</b>
                <span className="hint">{'Rank ' + valueRank + ' of ' + teams}</span>
              </div>
              <div>
                <span className="eyebrow">Bye clashes</span>
                <b>{mine.byeClashes}</b>
                <span className="hint">Starters sharing a week off</span>
              </div>
              <div>
                <span className="eyebrow">Shape</span>
                <b style={{ fontSize: 15, letterSpacing: '0.04em' }}>
                  {POSITIONS.filter((p) => mine.positionCounts[p])
                    .map((p) => mine.positionCounts[p] + p).join(' ')}
                </b>
              </div>
            </div>
            <p className="hint" style={{ maxWidth: 'min(62ch, 100%)' }}>
              The letter comes from starting points, because that is what decides games. Value
              against ADP sits beside it rather than inside it: a draft can win on value and still
              field the wrong team.
            </p>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn is-primary" onClick={onRestart}>
                Run it again
              </button>
              <button type="button" className="btn" onClick={onNewSettings}>
                Change the settings
              </button>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="eyebrow">The room</h2>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Grade</th>
                <th className="right">Starting points</th>
                <th className="right">Value</th>
                <th className="right hide-narrow">Bye clashes</th>
                <th className="hide-narrow">Shape</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((r) => (
                <tr key={r.team.index} className={r.team.isUser ? 'is-mine' : ''}>
                  <td className="num">{r.rank}</td>
                  <td>{seat(r.team)}</td>
                  <td className="num">{r.grade}</td>
                  <td className="right num">{Math.round(r.points)}</td>
                  <td className="right num">{gain(r.value)}</td>
                  <td className="right num hide-narrow">{r.byeClashes}</td>
                  <td className="mono hide-narrow" style={{ fontSize: 11, color: 'var(--chalk-3)' }}>
                    {POSITIONS.filter((p) => r.positionCounts[p])
                      .map((p) => r.positionCounts[p] + p).join(' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="eyebrow">The picks that beat ADP by the most</h2>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Pick</th>
                <th>Player</th>
                <th className="hide-narrow">Team</th>
                <th className="right">ADP</th>
                <th className="right">Gained</th>
              </tr>
            </thead>
            <tbody>
              {steals.map(({ pick, player, gain: g }) => (
                <tr
                  key={pick.overall}
                  className={engine.state.teams[pick.teamIndex].isUser ? 'is-mine' : ''}
                >
                  <td className="num">
                    {pick.round + '.' + String(pick.slotInRound).padStart(2, '0')}
                  </td>
                  <td data-pos={player.position}>
                    <span className="pos-tag" style={{ marginRight: 8 }}>{player.position}</span>
                    {player.name}
                  </td>
                  <td className="hide-narrow">{seat(engine.state.teams[pick.teamIndex])}</td>
                  <td className="right num">{player.adp.toFixed(1)}</td>
                  <td className="right num">{gain(g)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <RosterPanel
            players={mine.players}
            roster={roster}
            title={anonymous ? 'Your team' : seat(mine.team)}
          />
        </section>
      </div>
    </div>
  );
}
