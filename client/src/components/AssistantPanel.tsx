import type { LeagueSetup, SavedLeague } from '../engine/types';

interface Props {
  league: SavedLeague | null;
  setup: LeagueSetup | null;
  myUserId: string | null;
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
  leagueLabel: string;
}

const STATUS_WORDS: Record<string, string> = {
  pre_draft: 'has not opened yet',
  drafting: 'is running now',
  paused: 'is paused',
  complete: 'is finished',
};

/**
 * Getting ready to follow a real draft.
 *
 * Two things have to be true before the assistant can help: the app has to know
 * which league you are drafting in, and which manager in it is you. Sleeper
 * does not publish the draft order until minutes before the draft, so the slot
 * cannot be read early. Saying which manager you are can be done now and is
 * remembered, and the slot follows on its own the moment the order is drawn.
 */
export default function AssistantPanel(props: Props) {
  const {
    league, setup, myUserId, busy, error, onRefresh, leagueLabel,
  } = props;
  const draft = setup?.draft ?? null;
  const seats = setup?.slots ?? [];

  if (!league) {
    return (
      <section className="panel span-2">
        <div className="panel-head">
          <h2 className="eyebrow">Follow a real draft</h2>
        </div>
        <div className="setup-body">
          <p className="hint">Choose one of your leagues above first.</p>
        </div>
      </section>
    );
  }

  const slot = seats.find((m) => m.userId === myUserId)?.slot;

  return (
    <section className="panel span-2">
      <div className="panel-head">
        <h2 className="eyebrow">Follow a real draft</h2>
        <button type="button" className="btn is-quiet" disabled={busy} onClick={onRefresh}>
          {busy ? 'Checking…' : 'Check Sleeper'}
        </button>
      </div>

      <div className="setup-body">
        <div>
          {!draft && <p className="hint">Not read yet. Press Check Sleeper.</p>}
          {draft && (
            <>
              <p className="eyebrow">The draft</p>
              <p style={{ margin: '2px 0 0' }}>
                {leagueLabel}
                {' '}
                {STATUS_WORDS[draft.status] || draft.status}
              </p>
              <p className="hint">
                {draft.teams + ' teams, ' + draft.rounds + ' rounds, ' + draft.type + '. '}
                {draft.startTime
                  ? 'Starts ' + new Date(draft.startTime).toLocaleString(undefined, {
                    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                  }) + '. '
                  : ''}
                {slot
                  ? 'You are in seat ' + slot + '.'
                  : (draft.orderIsSet
                    ? 'The order is set. Pick your name above to take your seat.'
                    : 'The draft order is not drawn yet, so no seat is known. '
                      + 'It appears here once Sleeper sets it.')}
              </p>
              {setup && setup.namedTeams > 0 && (
                <p className="hint" style={{ marginTop: 4 }}>
                  {setup.namedTeams + ' of ' + setup.teams
                    + ' seats carry a team name, and the board uses them.'}
                </p>
              )}
            </>
          )}
        </div>

        {error && <div className="banner is-bad"><span>{error}</span></div>}

        {draft && !draft.started && (
          <div className="banner">
            <span>
              This draft has not opened. You can still follow it: the board fills as picks land.
              Until then, run a mock instead to get a feel for the room.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
