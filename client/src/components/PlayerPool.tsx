import { useMemo, useState } from 'react';
import { survivalOdds } from '../engine/survival';
import useNarrow from '../useNarrow';
import type { Player, Position } from '../engine/types';
import { POSITIONS } from '../engine/types';

const SORT_WORDS: Record<SortKey, string> = {
  adp: 'ADP', mine: 'My rank', points: 'Points', odds: 'Going soon',
};

export type SortKey = 'adp' | 'mine' | 'points' | 'odds';

interface Props {
  players: Player[];
  myRank: Map<string, number> | null;
  currentPick: number;
  myNextPick: number | null;
  teams: number;
  onDraft: (id: string) => void;
  canDraft: boolean;
  queue: string[];
  onQueue: (id: string) => void;
  formatLabel: string;
}

function pickLabel(overall: number, teams: number): string {
  const round = Math.floor((overall - 1) / teams) + 1;
  const slot = ((overall - 1) % teams) + 1;
  return round + '.' + String(slot).padStart(2, '0');
}

export default function PlayerPool(props: Props) {
  const {
    players, myRank, currentPick, myNextPick, teams, onDraft, canDraft, queue, onQueue,
  } = props;

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Position | 'ALL' | 'QUEUE'>('ALL');
  const [sort, setSort] = useState<SortKey>(myRank ? 'mine' : 'adp');
  const narrow = useNarrow();

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let out = players;

    if (filter === 'QUEUE') out = out.filter((p) => queue.includes(p.id));
    else if (filter !== 'ALL') out = out.filter((p) => p.position === filter);

    if (needle) {
      out = out.filter((p) => p.name.toLowerCase().includes(needle)
        || p.team.toLowerCase().includes(needle));
    }

    const scored = out.map((p) => ({
      player: p,
      odds: myNextPick ? survivalOdds(p, currentPick, myNextPick) : 1,
      mine: myRank?.get(p.id) ?? Number.MAX_SAFE_INTEGER,
    }));

    scored.sort((a, b) => {
      if (sort === 'mine') return a.mine - b.mine || a.player.adp - b.player.adp;
      if (sort === 'points') return (b.player.points ?? -1) - (a.player.points ?? -1);
      if (sort === 'odds') return a.odds - b.odds || a.player.adp - b.player.adp;
      return a.player.adp - b.player.adp;
    });

    /*
     * THE WHOLE POOL
     *
     * This used to stop at 300 rows and say nothing about it. With 550 players
     * left that hid 250 of them, and under the "Mine" sort the cap landed almost
     * exactly at the end of a 300 player ranking file, so every unranked player
     * was invisible. Going looking for one and not finding him reads as the
     * player being gone rather than the list being short.
     */
    return scored;
  }, [players, search, filter, sort, queue, myRank, currentPick, myNextPick]);

  return (
    <>
      <div className="pool-controls">
        {/*
          * On a phone the search box and the sort share a row, and the sort is
          * a select rather than four chips. The chips are the better control
          * and they cost a whole row of a screen whose job is the list under
          * them. Sort is set once a draft; the position filter is not, so that
          * one keeps its chips.
          */}
        <div className="pool-find">
          <input
            className="input"
            type="search"
            value={search}
            placeholder={narrow ? 'Search ' + players.length + ' players' : 'Search a player or team'}
            aria-label="Search the pool"
            onChange={(e) => setSearch(e.target.value)}
          />
          {narrow && (
            <select
              className="input pool-sort"
              aria-label="Sort the pool"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {(['adp', 'mine', 'points', 'odds'] as SortKey[])
                .filter((k) => k !== 'mine' || myRank)
                .map((k) => <option key={k} value={k}>{SORT_WORDS[k]}</option>)}
            </select>
          )}
        </div>
        <div className="filter-row">
          <button type="button" className="chip" aria-pressed={filter === 'ALL'} onClick={() => setFilter('ALL')}>All</button>
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              type="button"
              className="chip"
              data-pos={pos}
              aria-pressed={filter === pos}
              onClick={() => setFilter(pos)}
            >
              {pos}
            </button>
          ))}
          <button
            type="button"
            className="chip"
            aria-pressed={filter === 'QUEUE'}
            onClick={() => setFilter('QUEUE')}
          >
            <span className="on-wide">{'Queue ' + queue.length}</span>
            <span className="on-narrow">{'☆ ' + queue.length}</span>
          </button>
        </div>
        <div className="filter-row sort-row" style={{ alignItems: 'center', gap: 8 }}>
          <span className="eyebrow">Sort</span>
          <button type="button" className="chip" aria-pressed={sort === 'adp'} onClick={() => setSort('adp')}>ADP</button>
          {myRank && <button type="button" className="chip" aria-pressed={sort === 'mine'} onClick={() => setSort('mine')}>Mine</button>}
          <button type="button" className="chip" aria-pressed={sort === 'points'} onClick={() => setSort('points')}>Points</button>
          <button type="button" className="chip" aria-pressed={sort === 'odds'} onClick={() => setSort('odds')}>
            <span className="on-wide">Least likely to last</span>
            <span className="on-narrow">Going soon</span>
          </button>
        </div>
      </div>

      <div className="pool-list" role="list">
        {rows.length === 0 && (
          <p className="hint" style={{ padding: '18px 12px' }}>
            Nobody left matching that.
          </p>
        )}

        {rows.map(({ player, odds, mine }) => {
          const queued = queue.includes(player.id);
          const pct = Math.round(odds * 100);
          return (
            <div
              key={player.id}
              className="player"
              data-pos={player.position}
              role="listitem"
            >
              <button
                type="button"
                className="star"
                aria-pressed={queued}
                aria-label={queued ? 'Take ' + player.name + ' off the queue' : 'Queue ' + player.name}
                onClick={() => onQueue(player.id)}
              >
                {queued ? '★' : '☆'}
              </button>

              <span className="pos-tag">{player.position}</span>

              <button
                type="button"
                onClick={() => canDraft && onDraft(player.id)}
                disabled={!canDraft}
                title={canDraft ? 'Draft ' + player.name : 'Not your pick'}
                style={{
                  background: 'none', border: 0, padding: 0, textAlign: 'left', minWidth: 0,
                  cursor: canDraft ? 'pointer' : 'default',
                }}
              >
                <span className="player-name">{player.name}</span>
                <span className="player-sub">
                  {player.team}
                  {player.bye ? ' · BYE ' + player.bye : ''}
                  {mine !== Number.MAX_SAFE_INTEGER ? ' · MINE ' + mine : ''}
                  {player.injuryStatus ? ' · ' : ''}
                  {player.injuryStatus && <span className="injury">{player.injuryStatus}</span>}
                </span>
              </button>

              <span className="player-num">
                <b>{player.adp.toFixed(1)}</b>
                <small>ADP</small>
              </span>

              <span className="player-num">
                <b>{player.points != null ? Math.round(player.points) : '—'}</b>
                <small>PROJ</small>
              </span>

              {myNextPick && (
                <span className="survival">
                  <span className="survival-track">
                    <span
                      className={'survival-fill' + (pct < 25 ? ' is-thin' : '')}
                      style={{ width: Math.max(2, pct) + '%' }}
                    />
                  </span>
                  <span className="survival-odds">
                    {pct + '% to ' + pickLabel(myNextPick, teams)}
                  </span>
                </span>
              )}

            </div>
          );
        })}
      </div>
    </>
  );
}
