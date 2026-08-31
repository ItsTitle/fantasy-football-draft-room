import { useEffect, useRef } from 'react';
import { maskTeam } from '../anon';
import { roundOrder } from '../engine/order';
import type { DraftEngine } from '../engine/draft';

interface Props {
  engine: DraftEngine;
  currentPick: number;
  anonymous: boolean;
}

/**
 * The board, as it hangs on a wall: a column per team, a row per round, and a
 * sticker in every cell. The arrow beside each round number carries the one
 * fact a grid cannot show on its own, which is which way the order runs.
 */
export default function DraftBoard({ engine, currentPick, anonymous }: Props) {
  const { state } = engine;
  const { teams, rounds, draftType } = state.league;
  const scroller = useRef<HTMLDivElement>(null);
  const onClock = useRef<HTMLDivElement>(null);

  // Keep the pick on the clock in view without stealing focus.
  useEffect(() => {
    const cell = onClock.current;
    const box = scroller.current;
    if (!cell || !box) return;
    const top = cell.offsetTop - box.clientHeight / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [Math.floor((currentPick - 1) / teams)]);

  const byOverall = new Map(state.picks.map((p) => [p.overall, p]));
  const latest = state.picks.length ? state.picks[state.picks.length - 1].overall : 0;

  /*
   * A seat that sold its whole draft to one team is a seat swap, and belongs in
   * the heading rather than repeated down every cell of the column.
   *
   * This league has two of them: one pair traded every round both ways. Tagging
   * each cell put the same twenty one character name in the column sixteen
   * times and buried the player under it. A trade that covers part of a column
   * still says so per cell, because there the round is the point.
   */
  const soldWhole = new Map<number, number>();
  for (const seat of state.teams) {
    const owners = new Set<number>();
    for (let round = 1; round <= rounds; round += 1) {
      const slot = roundOrder(draftType, round, teams).indexOf(seat.index);
      owners.add(state.order[(round - 1) * teams + slot]);
    }
    const only = owners.size === 1 ? [...owners][0] : null;
    if (only != null && only !== seat.index) soldWhole.set(seat.index, only);
  }

  // Columns are capped, not content sized. Team names vary from "jet82" to
  // "Mo1stRd Picks Mo Problems", and letting the widest one set the width puts
  // the far side of a twelve team board a very long scroll away.
  const columns = '44px repeat(' + teams + ', minmax(92px, 124px))';

  return (
    <div className="board-scroll" ref={scroller}>
      <div className="board-grid" style={{ gridTemplateColumns: columns }}>
        <div className="board-head" style={{ position: 'sticky', left: 0, zIndex: 3 }} />
        {state.teams.map((t) => {
          const bought = soldWhole.get(t.index);
          const owner = bought == null ? null : state.teams[bought];
          const seatName = maskTeam(t.name, t.index, t.isUser, anonymous);
          const ownerName = owner
            ? maskTeam(owner.name, owner.index, owner.isUser, anonymous)
            : null;
          return (
            <div
              key={t.index}
              className={'board-head' + ((owner ?? t).isUser ? ' is-you' : '')}
              title={ownerName
                ? seatName + ' traded this whole column to ' + ownerName
                : seatName}
            >
              {ownerName ?? seatName}
              {ownerName && <span className="head-from">{'from ' + seatName}</span>}
            </div>
          );
        })}

        {Array.from({ length: rounds }, (_, r) => r + 1).flatMap((round) => {
          const order = roundOrder(draftType, round, teams);
          const reversed = order[0] !== 0;

          // Cells sit in team column order, not pick order. In a snake round the
          // first pick belongs to the last column, and putting the picks down in
          // the order they happened would silently mirror the whole board.
          const cells = state.teams.map((seat) => {
            const slot = order.indexOf(seat.index);
            const overall = (round - 1) * teams + slot + 1;

            // The column is the seat that owns this pick by right. Who makes it
            // is a separate question once picks have been traded, and the board
            // has to answer both: the pick stays in this column, and the team
            // holding it now is named on the sticker.
            const team = state.teams[state.order[overall - 1]] ?? seat;
            // A whole column that changed hands says so once, in the heading.
            const traded = team.index !== seat.index && !soldWhole.has(seat.index);

            const pick = byOverall.get(overall);
            // A settled pick is on the board from the moment the draft opens.
            // Waiting for the clock to reach round eight to show a keeper hides
            // the one thing everybody already knows about that pick.
            const preset = engine.presets.get(overall);
            const source = pick?.preset ?? (pick ? null : preset?.source ?? null);
            const player = pick
              ? engine.byId.get(pick.playerId)
              : (preset ? engine.byId.get(preset.playerId) : null) ?? null;
            const settledAhead = !pick && !!player;
            const isMine = team.isUser;
            const isNow = overall === currentPick;

            const cls = ['cell'];
            if (!player) cls.push('is-empty');
            if (isMine && player) cls.push('is-mine');
            if (isNow) cls.push('is-onclock');
            if (pick && pick.overall === latest) cls.push('is-new');
            if (source) cls.push('is-preset');
            // Settled, but the draft has not reached it. Shown quieter than a
            // pick that has actually happened.
            if (settledAhead) cls.push('is-ahead');
            if (traded) cls.push('is-traded');

            return (
              <div
                key={overall}
                className={cls.join(' ')}
                data-pos={player?.position}
                ref={isNow ? onClock : undefined}
                title={traded
                  ? maskTeam(seat.name, seat.index, seat.isUser, anonymous) + ' traded this pick to '
                    + maskTeam(team.name, team.index, team.isUser, anonymous)
                  : undefined}
              >
                <div className="cell-pick">
                  {round + '.' + String(slot + 1).padStart(2, '0')}
                  {traded && (
                    <span className="cell-owner">
                      {'→ ' + maskTeam(team.name, team.index, team.isUser, anonymous)}
                    </span>
                  )}
                </div>
                {player ? (
                  <>
                    <div className="cell-name">{player.name}</div>
                    <div className="cell-meta">
                      {player.position}
                      {' · '}
                      {player.team}
                      {source === 'keeper' ? ' · KEPT' : ''}
                      {source === 'live' ? ' · REAL' : ''}
                    </div>
                  </>
                ) : (
                  isNow && <div className="cell-meta" style={{ color: 'var(--gold)' }}>On the clock</div>
                )}
              </div>
            );
          });

          return [
            <div className="board-round" key={'r' + round}>
              <span>{round}</span>
              <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
                <path
                  d={reversed ? 'M6 1 L2 4 L6 7' : 'M2 1 L6 4 L2 7'}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
              </svg>
            </div>,
            ...cells,
          ];
        })}
      </div>
    </div>
  );
}
