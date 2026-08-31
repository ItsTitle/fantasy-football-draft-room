import { useMemo, useState } from 'react';
import PlayerPicker from './PlayerPicker';
import { maskTeam } from '../anon';
import { keeperPicksIn, locate, pickOrder, picksInRound, roundOrder } from '../engine/order';
import type { LeagueConfig, PendingKeeper, Player, PresetPick } from '../engine/types';

interface Props {
  league: LeagueConfig;
  board: Player[];
  keepers: PresetPick[];
  /** Imported, but still missing the round. */
  pending: PendingKeeper[];
  onKeeperRound: (playerId: string, round: number) => void;
  onDropPending: (playerId: string) => void;
  maxKeepers: number;
  canImport: boolean;
  declared: number;
  anonymous: boolean;
  importing: boolean;
  importNote: string | null;
  onAdd: (pick: PresetPick) => void;
  onRemove: (overall: number) => void;
  onClear: () => void;
  onImport: () => void;
}

/**
 * Players who are off the board before the draft starts.
 *
 * A keeper is not just a player removed from the pool: it consumes the pick the
 * team paid for it. Both halves matter. Take the player out and leave the pick
 * standing and the room gets a free extra pick each; consume the pick and leave
 * the player in and he goes twice.
 *
 * Only a league that keeps players shows this panel. In a redraft league an
 * entry here would quietly fix a pick for no reason anybody asked for.
 */
export default function KeepersPanel(props: Props) {
  const {
    league, board, keepers, pending, maxKeepers, canImport, declared, anonymous, importing,
    importNote, onKeeperRound, onDropPending, onAdd, onRemove, onClear, onImport,
  } = props;

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [teamIndex, setTeamIndex] = useState(0);
  const [round, setRound] = useState(1);

  const byId = useMemo(() => new Map(board.map((p) => [p.id, p])), [board]);
  const taken = useMemo(() => new Set(keepers.map((k) => k.playerId)), [keepers]);
  const free = useMemo(() => board.filter((p) => !taken.has(p.id)), [board, taken]);

  /**
   * The first pick a team still has free in a round, or null.
   *
   * Not "the pick", because a round is no longer one pick each. Trade for a
   * rival's eighth and you hold two of them, and a keeper charged to round
   * eight spends whichever is still free.
   */
  const freePickIn = (team: number, r: number) => {
    const held = keeperPicksIn(league.draftType, league.teams, r, team, league.tradedPicks);
    return held.find((at) => !keepers.some((k) => k.overall === at)) ?? null;
  };

  const holdsAnyIn = (team: number, r: number) => picksInRound(
    league.draftType, league.teams, r, team, league.tradedPicks,
  ).length > 0;

  const pendingOverall = freePickIn(teamIndex, round);
  const noPickAtAll = !holdsAnyIn(teamIndex, round);
  const clash = pendingOverall == null && !noPickAtAll;

  const rows = useMemo(() => [...keepers]
    .sort((a, b) => a.overall - b.overall)
    .map((k) => {
      const { round: r, slotInRound } = locate(k.overall, league.teams);
      // Who spends this pick, which after a trade is not who the seat belongs
      // to. The keeper is the new owner's, and so is the row.
      const order = pickOrder(league.draftType, league.teams, r, league.tradedPicks);
      const owner = order[k.overall - 1];
      const seat = roundOrder(league.draftType, r, league.teams)[slotInRound - 1];
      return {
        pick: k,
        player: byId.get(k.playerId) || null,
        round: r,
        slotInRound,
        owner,
        // Set only when the pick changed hands, so the row can say so.
        via: owner === seat ? null : seat,
      };
    }), [keepers, byId, league.teams, league.draftType, league.tradedPicks]);

  const perTeam = new Map<number, number>();
  for (const row of rows) perTeam.set(row.owner, (perTeam.get(row.owner) || 0) + 1);
  const overCap = maxKeepers > 0
    ? [...perTeam.entries()].filter(([, n]) => n > maxKeepers)
    : [];

  const teamName = (i: number) => maskTeam(
    league.teamNames?.[i] ?? (i + 1 === league.mySlot ? 'You' : 'Team ' + (i + 1)),
    i,
    i + 1 === league.mySlot,
    anonymous,
  );

  return (
    <>
    <p className="hint">
      This league keeps players. Enter each one with the round it costs, and both the
      player and that pick come off the board before the draft runs.
    </p>

    {canImport && (
      <div>
        <button type="button" className="btn is-primary" disabled={importing} onClick={onImport}>
          {importing
            ? 'Reading Sleeper…'
            : 'Import the ' + declared + ' keeper' + (declared === 1 ? '' : 's')
              + ' declared so far'}
        </button>
        <p className="hint" style={{ marginTop: 6 }}>
          {importNote
            ?? 'Sleeper publishes who is kept and by whom. It does not publish what a '
              + 'keeper costs, so the round comes from where the player went last season. '
              + 'Check each one.'}
        </p>
      </div>
    )}

    {/*
      * WAITING ON A ROUND
      *
      * Sleeper says who is kept and never what he costs. Most are priced off
      * last season's draft; these are the ones that cannot be, because they
      * were picked up on waivers, or because another keeper already holds that
      * seat's pick in the round they would have cost.
      *
      * The import used to count them in a sentence and drop them, which left
      * you finding each player again by hand in a list of six hundred. All of
      * it is filled in here already. Only the round is missing, and a round
      * whose pick is spent is not offered.
      */}
    {pending.length > 0 && (
      <div className="pending-list">
        <p className="eyebrow">
          {pending.length === 1
            ? 'One keeper needs a round'
            : pending.length + ' keepers need a round'}
        </p>
        {pending.map((k) => {
          const openRounds = Array.from({ length: league.rounds }, (_, i) => i + 1)
            .filter((r) => freePickIn(k.slot - 1, r) != null);
          return (
            <div className="pending" key={k.playerId}>
              <div className="pending-who" data-pos={k.position}>
                <span className="pos-tag">{k.position || '??'}</span>
                <span className="pending-name">{k.name}</span>
                <span className="hint">
                  {(k.team ? k.team + ' · ' : '') + teamName(k.slot - 1)}
                </span>
              </div>
              <p className="hint pending-why">
                {k.reason === 'round-taken'
                  ? 'Last season he went in round ' + k.triedRound
                    + ', and another keeper already holds that pick.'
                  : 'He was never drafted in this league, so there is no round to guess from.'}
              </p>
              <div className="pending-acts">
                <select
                  className="input"
                  aria-label={'Which round ' + k.name + ' costs'}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) onKeeperRound(k.playerId, Number(e.target.value));
                  }}
                >
                  <option value="">Pick a round…</option>
                  {openRounds.map((r) => <option key={r} value={r}>{'Round ' + r}</option>)}
                </select>
                <button
                  type="button"
                  className="btn is-quiet"
                  title={'Leave ' + k.name + ' in the pool for the room to draft'}
                  onClick={() => onDropPending(k.playerId)}
                >
                  Leave him out
                </button>
              </div>
            </div>
          );
        })}
      </div>
    )}

    <div className="keeper-add">
      <PlayerPicker
        board={free}
        suggestions={[]}
        value={playerId}
        label="Which player is kept"
        onChange={setPlayerId}
      />
      <select
        className="input"
        aria-label="Which team keeps him"
        value={teamIndex}
        onChange={(e) => setTeamIndex(Number(e.target.value))}
      >
        {Array.from({ length: league.teams }, (_, i) => (
          <option key={i} value={i}>{teamName(i)}</option>
        ))}
      </select>
      <select
        className="input"
        aria-label="Which round it costs"
        value={round}
        onChange={(e) => setRound(Number(e.target.value))}
      >
        {Array.from({ length: league.rounds }, (_, i) => i + 1).map((r) => (
          <option key={r} value={r}>{'Round ' + r}</option>
        ))}
      </select>
      <button
        type="button"
        className="btn is-primary"
        disabled={!playerId || pendingOverall == null || clash}
        onClick={() => {
          if (!playerId || pendingOverall == null) return;
          onAdd({ overall: pendingOverall, playerId, source: 'keeper' });
          setPlayerId(null);
          // Move to the next team so a full room is entered without fiddling.
          setTeamIndex((i) => (i + 1) % league.teams);
        }}
      >
        Add
      </button>
    </div>

    {(clash || noPickAtAll) && (
      <p className="hint" style={{ color: 'var(--te)' }}>
        {noPickAtAll
          ? teamName(teamIndex) + ' traded away every pick it had in round ' + round + '.'
          : teamName(teamIndex) + ' has no pick left in round ' + round
            + '; the ones it holds are already spent on keepers.'}
      </p>
    )}

    {rows.length > 0 && (
      <table className="table keeper-table">
        <thead>
          <tr>
            <th>Pick</th>
            <th>Player</th>
            <th>Team</th>
            <th>How</th>
            <th aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.pick.overall} className={row.owner + 1 === league.mySlot ? 'is-mine' : ''}>
              <td className="num">
                {row.round + '.' + String(row.slotInRound).padStart(2, '0')}
              </td>
              <td data-pos={row.player?.position}>
                {row.player ? (
                  <>
                    <span className="pos-tag" style={{ marginRight: 8 }}>{row.player.position}</span>
                    {row.player.name}
                    <span className="hint">{' ' + row.player.team}</span>
                  </>
                ) : (
                  <span className="hint">no longer on the board</span>
                )}
              </td>
              <td>{teamName(row.owner)}</td>
              <td className="hint">{row.pick.source === 'live' ? 'from Sleeper' : 'entered'}</td>
              <td className="right">
                <button
                  type="button"
                  className="link"
                  onClick={() => onRemove(row.pick.overall)}
                >
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}

    {overCap.length > 0 && (
      <div className="banner">
        <span>
          {overCap.map(([team, n]) => teamName(team) + ' has ' + n).join(', ')}
          {' keepers, and this league allows ' + maxKeepers + '.'}
        </span>
      </div>
    )}

    {rows.length > 0 && (
      <div>
        <button type="button" className="btn is-quiet" onClick={onClear}>
          Clear them all
        </button>
      </div>
    )}
    </>
  );
}
