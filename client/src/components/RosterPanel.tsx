import { FLEX_POSITIONS, SUPERFLEX_POSITIONS, STARTER_SLOTS } from '../engine/roster';
import type { Player, Position, RosterSlots } from '../engine/types';
import { POSITIONS } from '../engine/types';

interface Props {
  players: Player[];
  roster: RosterSlots;
  title: string;
  /** Players who were kept rather than drafted. Marked, not hidden. */
  keptIds?: Set<string>;
}

interface Row {
  label: string;
  player: Player | null;
}

/**
 * Lay a squad into the slots it will actually start in, open slots included.
 *
 * The open slots are the point. A list of who you drafted tells you nothing;
 * a list with two empty receiver rows in it tells you what to do next.
 */
function layout(players: Player[], roster: RosterSlots): { starters: Row[]; bench: Player[] } {
  const pool = new Map<Position, Player[]>();
  for (const pos of POSITIONS) {
    pool.set(pos, players
      .filter((p) => p.position === pos)
      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0)));
  }

  const rows: Row[] = [];
  const used = new Set<string>();

  const take = (allowed: Position[], label: string, slots: number) => {
    for (let i = 0; i < slots; i += 1) {
      let best: Player | null = null;
      for (const pos of allowed) {
        const candidate = (pool.get(pos) || []).find((p) => !used.has(p.id));
        if (candidate && (!best || (candidate.points ?? 0) > (best.points ?? 0))) best = candidate;
      }
      if (best) used.add(best.id);
      rows.push({ label, player: best });
    }
  };

  for (const slot of STARTER_SLOTS) {
    if (!roster[slot]) continue;
    if (slot === 'FLEX') take(FLEX_POSITIONS, 'FLEX', roster.FLEX);
    else if (slot === 'SUPERFLEX') take(SUPERFLEX_POSITIONS, 'SFLEX', roster.SUPERFLEX);
    else take([slot as Position], slot, roster[slot]);
  }

  return { starters: rows, bench: players.filter((p) => !used.has(p.id)) };
}

export default function RosterPanel({ players, roster, title, keptIds }: Props) {
  const { starters, bench } = layout(players, roster);

  const byeCount = new Map<number, number>();
  for (const row of starters) {
    if (row.player?.bye) byeCount.set(row.player.bye, (byeCount.get(row.player.bye) || 0) + 1);
  }

  const points = starters.reduce((n, r) => n + (r.player?.points ?? 0), 0);
  const open = starters.filter((r) => !r.player).length;

  return (
    <>
      <div className="panel-head">
        <h2 className="eyebrow">{title}</h2>
        <span className="hint mono">{Math.round(points)}</span>
      </div>

      <div className="roster-list">
        {starters.map((row, i) => (
          <div
            key={row.label + i}
            className={'roster-slot' + (row.player ? '' : ' is-open')}
            data-pos={row.player?.position}
          >
            <span className="slot-label">{row.label}</span>
            <span className="roster-name">
              {row.player ? row.player.name : 'open'}
              {row.player && keptIds?.has(row.player.id)
                ? <span className="kept-tag">kept</span>
                : null}
            </span>
            <span className={'roster-bye' + ((row.player?.bye && (byeCount.get(row.player.bye) || 0) > 1) ? ' is-clash' : '')}>
              {row.player?.bye ?? ''}
            </span>
          </div>
        ))}

        <div className="roster-divider">
          <span className="eyebrow">
            {'Bench ' + bench.length}
          </span>
        </div>

        {bench.map((p) => (
          <div key={p.id} className="roster-slot" data-pos={p.position}>
            <span className="slot-label">{p.position}</span>
            <span className="roster-name">
              {p.name}
              {keptIds?.has(p.id) ? <span className="kept-tag">kept</span> : null}
            </span>
            <span className="roster-bye">{p.bye ?? ''}</span>
          </div>
        ))}

        {open > 0 && (
          <p className="hint" style={{ marginTop: 10 }}>
            {open === 1 ? 'One starting slot is still open.' : open + ' starting slots are still open.'}
          </p>
        )}
      </div>
    </>
  );
}
