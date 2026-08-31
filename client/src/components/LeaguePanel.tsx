import { useState } from 'react';
import { maskLeague, maskTeam } from '../anon';
import type { LeagueImport, LeagueSetup, SavedLeague } from '../engine/types';

interface Props {
  leagues: SavedLeague[];
  activeId: string | null;
  imported: LeagueImport | null;
  busy: boolean;
  error: string | null;
  onLoad: (id: string) => void;
  onAdd: (id: string) => void;
  onRefresh: (id: string) => void;
  onRemove: (id: string) => void;
  anonymous: boolean;
  setup: LeagueSetup | null;
  myUserId: string | null;
  onMyUser: (userId: string) => void;
}

/** How long ago a league's settings were pulled, in plain words. */
function pulledWhen(at: number | null): string {
  if (!at) return 'not pulled yet';
  const hours = (Date.now() - at) / 3600000;
  if (hours < 1) return 'pulled in the last hour';
  if (hours < 24) return 'pulled ' + Math.round(hours) + ' hours ago';
  const days = Math.round(hours / 24);
  return 'pulled ' + days + (days === 1 ? ' day ago' : ' days ago');
}

const SCORING_WORDS: Record<string, string> = {
  standard: 'standard', 'half-ppr': 'half PPR', ppr: 'PPR', '2qb': 'superflex', dynasty: 'dynasty',
};

/**
 * Load the settings out of a Sleeper league you actually play in.
 *
 * Sleeper publishes a league without a key, so the whole setup is a league ID.
 * What it cannot tell us is which slot is yours: the draft order is not set
 * until the draft starts. That one field stays yours to pick.
 */
export default function LeaguePanel(props: Props) {
  const {
    leagues, activeId, imported, busy, error, onLoad, onAdd, onRefresh, onRemove, anonymous,
    setup, myUserId, onMyUser,
  } = props;
  const seats = setup?.slots ?? [];
  const mySeat = seats.find((s2) => s2.userId === myUserId) || null;
  const shown = (id: string) => {
    const i = leagues.findIndex((l) => l.id === id);
    const found = leagues[i];
    return maskLeague(found ? found.name : 'Sleeper league', i < 0 ? 0 : i, anonymous);
  };
  const [typed, setTyped] = useState('');
  const active = leagues.find((l) => l.id === activeId) || null;

  // Trades change which picks are yours, so they change what a mock of this
  // league is worth. The seat alone no longer answers "when do I pick".
  const trades = setup?.tradedPicks ?? [];
  const myTrades = {
    bought: mySeat ? trades.filter((t) => t.toSlot === mySeat.slot).length : 0,
    sold: mySeat ? trades.filter((t) => t.fromSlot === mySeat.slot).length : 0,
  };

  return (
    <>
    <div className="preset-row">
      {leagues.map((l) => (
        <span className="league-chip" key={l.id} data-active={activeId === l.id}>
          <button
            type="button"
            className="preset"
            aria-pressed={activeId === l.id}
            disabled={busy}
            onClick={() => onLoad(l.id)}
          >
            {maskLeague(l.name, leagues.indexOf(l), anonymous)}
          </button>
          <button
            type="button"
            className="league-drop"
            aria-label={'Forget ' + maskLeague(l.name, leagues.indexOf(l), anonymous)}
            title={'Forget this league'}
            onClick={() => onRemove(l.id)}
          >
            ×
          </button>
        </span>
      ))}
      {leagues.length === 0 && <p className="hint">No leagues saved yet.</p>}
    </div>

    {seats.length > 0 && (
      <div className="field">
        <label htmlFor="myUser">Which manager are you</label>
        <select
          id="myUser"
          className="input"
          style={{ maxWidth: 380 }}
          value={myUserId || ''}
          onChange={(e) => onMyUser(e.target.value)}
        >
          <option value="">Pick your name…</option>
          {seats.filter((m) => m.userId).map((m) => (
            <option key={m.userId!} value={m.userId!}>
              {m.slot + '. ' + maskTeam(m.name, m.slot - 1, m.userId === myUserId, anonymous)
                + (anonymous || !m.manager || m.manager === m.name ? '' : ' — ' + m.manager)}
            </option>
          ))}
        </select>
        <p className="hint">
          {mySeat
            ? 'You draft from seat ' + mySeat.slot + '. A mock of this league sits you there '
              + 'too, so the picks you rehearse are the picks you get.'
            : 'This sets your draft slot, and marks your picks when following the real draft.'}
        </p>
        {trades.length > 0 && (
          <p className="hint">
            {trades.length + ' pick' + (trades.length === 1 ? ' has' : 's have')
              + ' changed hands here, and the board follows them. '}
            {mySeat && (myTrades.bought || myTrades.sold)
              ? 'You bought ' + myTrades.bought + ' and sold ' + myTrades.sold + '.'
              : ''}
            {mySeat && !myTrades.bought && !myTrades.sold ? 'None of them are yours.' : ''}
          </p>
        )}
      </div>
    )}

    <div className="grid-2">
      <div className="field">
        <label htmlFor="leagueId">Add a league by ID</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            id="leagueId"
            className="input"
            value={typed}
            inputMode="numeric"
            placeholder="the long number from your league address"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && typed.trim()) { onAdd(typed.trim()); setTyped(''); }
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={!typed.trim() || busy}
            onClick={() => { onAdd(typed.trim()); setTyped(''); }}
          >
            Add
          </button>
        </div>
        <p className="hint">
          The ID is the long number in your league's Sleeper web address.
        </p>
      </div>

      <div>
        {busy && <p className="hint">Reading the league.</p>}

        {imported && !busy && (
          <>
            <p className="eyebrow">Loaded</p>
            <p style={{ margin: '2px 0 0' }}>
              {shown(imported.id)}
              {imported.season ? ', ' + imported.season : ''}
            </p>
            <p className="hint">
              {imported.teams + ' teams, ' + imported.rounds + ' rounds, '
                + (SCORING_WORDS[imported.scoring] || imported.scoring) + ', '
                + (imported.draftType === 'snake' ? 'snake' : imported.draftType) + '. '}
              {imported.roster.K === 0 ? 'No kicker. ' : ''}
              {imported.roster.FLEX > 1 ? imported.roster.FLEX + ' flex slots. ' : ''}
              Pick your own draft slot below; Sleeper does not set the order until the draft
              starts.
            </p>
            <p className="hint" style={{ marginTop: 6 }}>
              {'Settings ' + pulledWhen(active?.fetchedAt ?? null) + '. '}
              <button
                type="button"
                className="link"
                disabled={busy}
                onClick={() => onRefresh(imported.id)}
              >
                Refresh from Sleeper
              </button>
            </p>
          </>
        )}
      </div>
    </div>

    {error && (
      <div className="banner is-bad">
        <span>{error}</span>
      </div>
    )}

    {imported && imported.warnings.length > 0 && (
      <div className="banner">
        <span>
          <b>{'Worth knowing about ' + shown(imported.id) + ':'}</b>
          <br />
          {imported.warnings.join(' ')}
        </span>
      </div>
    )}
    </>
  );
}
