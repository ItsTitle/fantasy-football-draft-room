import { useEffect, useMemo, useRef, useState } from 'react';
import type { Player, Suggestion } from '../engine/types';

interface Props {
  board: Player[];
  suggestions: Suggestion[];
  value: string | null;
  onChange: (playerId: string | null) => void;
  label: string;
}

/** How many rows the list shows at once. Past this, type another letter. */
const SHOWN = 40;

/** Fold text to the shape a query is typed in, so a query needs no apostrophe. */
function fold(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

interface Row {
  player: Player;
  suggested: boolean;
  rank: number;
}

/**
 * Find a player by typing his name.
 *
 * This replaced a native select holding six hundred options. On a desktop that
 * select was serviceable, because typing a few letters jumps through the list.
 * On a phone it is a six hundred item wheel, and finding Kenneth Walker means
 * spinning past everybody the room drafts before him.
 *
 * The match runs per word and anywhere in the row, so "walk" finds him, "sea"
 * finds every Seahawk, and "rb sea" finds their backs. A word start sorts above
 * a hit inside a name, and ADP breaks the tie: the player you meant is nearly
 * always the one the room takes first.
 */
export default function PlayerPicker({ board, suggestions, value, onChange, label }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const chosen = useMemo(() => board.find((p) => p.id === value) ?? null, [board, value]);
  const suggestedIds = useMemo(() => new Set(suggestions.map((s) => s.id)), [suggestions]);
  const terms = useMemo(() => fold(query).split(' ').filter(Boolean), [query]);

  const hits = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const player of board) {
      const name = fold(player.name);
      const team = fold(player.team);
      const position = fold(player.position);
      const hay = name + ' ' + team + ' ' + position;

      let rank = 0;
      let hit = true;
      for (const term of terms) {
        const at = hay.indexOf(term);
        if (at < 0) { hit = false; break; }
        // A whole team code or position is the strongest signal there is: it is
        // the whole of the field rather than a run of letters inside one. Not
        // scoring it that way put Sean Tucker of Tampa Bay above every Seahawk
        // for "rb sea", because "sea" also starts his first name.
        if (term === team || term === position) rank += 4;
        else if (name.startsWith(term)) rank += 3;
        else if (at === 0 || hay[at - 1] === ' ') rank += 2;
        else rank += 1;
      }
      if (!hit) continue;
      out.push({ player, suggested: suggestedIds.has(player.id), rank });
    }

    out.sort((a, b) => {
      // With nothing typed the closest matches lead. Once you type, what you
      // typed decides the order and a stale suggestion does not jump the queue.
      if (!terms.length && a.suggested !== b.suggested) return a.suggested ? -1 : 1;
      if (terms.length && b.rank !== a.rank) return b.rank - a.rank;
      return a.player.adp - b.player.adp;
    });

    return out;
  }, [board, terms, suggestedIds]);

  const rows = useMemo(() => hits.slice(0, SHOWN), [hits]);

  useEffect(() => { setCursor(0); }, [query]);

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    const away = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  // Keep the highlighted row in view when the keyboard moves it.
  useEffect(() => {
    const row = listRef.current?.children[cursor];
    if (row) (row as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const choose = (id: string) => {
    onChange(id);
    setQuery('');
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[cursor];
      if (row) choose(row.player.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="picker" ref={boxRef}>
      <button
        type="button"
        className={'picker-face' + (chosen ? ' is-set' : '')}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        {chosen ? (
          <>
            <span className="pos-tag" data-pos={chosen.position}>{chosen.position}</span>
            <span className="picker-name">{chosen.name}</span>
            <span className="hint mono">
              {(chosen.team || 'FA') + ' · ' + chosen.adp.toFixed(1)}
            </span>
          </>
        ) : (
          <span className="picker-empty">Search for a player</span>
        )}
        <span className="picker-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="picker-drop">
          <input
            ref={inputRef}
            className="input picker-input"
            type="text"
            value={query}
            placeholder="Name, team or position"
            aria-label={label}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />

          <ul className="picker-list" ref={listRef} role="listbox" aria-label={label}>
            {rows.map((row, i) => (
              <li key={row.player.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={row.player.id === value}
                  className={'picker-row' + (i === cursor ? ' is-cursor' : '')}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(row.player.id)}
                >
                  <span className="pos-tag" data-pos={row.player.position}>
                    {row.player.position}
                  </span>
                  <span className="picker-name">{row.player.name}</span>
                  {row.suggested && !terms.length && <span className="picker-flag">closest</span>}
                  <span className="hint mono">
                    {(row.player.team || 'FA') + ' · ' + row.player.adp.toFixed(1)}
                  </span>
                </button>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="picker-none">No player on this board matches that.</li>
            )}
          </ul>

          <div className="picker-foot">
            <span className="hint">
              {hits.length > rows.length
                ? 'Showing ' + rows.length + ' of ' + hits.length + '. Type more to narrow it.'
                : hits.length + (hits.length === 1 ? ' player' : ' players')}
            </span>
            {value && (
              <button
                type="button"
                className="link"
                onClick={() => { onChange(null); setQuery(''); setOpen(false); }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
