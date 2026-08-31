interface Props {
  /** Whether the league has a draft that has opened. */
  started: boolean;
  /** Whether the league has a draft at all. */
  hasDraft: boolean;
  on: boolean;
  onChange: (on: boolean) => void;
  picks: { picks: number; at: number } | null;
  total: number;
  busy: boolean;
  error: string | null;
  onCheck: () => void;
  leagueLabel: string;
}

function ago(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'a minute ago' : minutes + ' minutes ago';
}

/**
 * Start a mock from where your real draft has got to.
 *
 * A mock answers "how might this go". Once a draft is running the question
 * narrows: the first three rounds are settled facts and what you want is the
 * next three, from the board as it actually stands. This reads the picks that
 * have been made, hands them to the engine as settled, and simulates only the
 * rest.
 *
 * It is not the draft assistant. The assistant simulates nothing and waits on
 * the room; this runs the room forward from the same starting point, as many
 * times as you like.
 */
export default function ResumePanel(props: Props) {
  const {
    started, hasDraft, on, onChange, picks, total, busy, error, onCheck, leagueLabel,
  } = props;

  return (
    <>
      <label className="resume-switch">
        <input
          type="checkbox"
          checked={on}
          disabled={!hasDraft}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          <b>Pick up from the live draft.</b>
          {' The picks already made are taken as they were, and the room drafts on '
            + 'from there.'}
        </span>
      </label>

      {!hasDraft && (
        <p className="hint">
          {leagueLabel + ' has no draft to read yet. Load a Sleeper league with one.'}
        </p>
      )}

      {hasDraft && !started && (
        <p className="hint">
          This draft has not opened, so there is nothing to pick up from. A mock will run
          the whole draft from pick one until it does.
        </p>
      )}

      {hasDraft && started && on && (
        <div>
          <p className="hint">
            {picks
              ? picks.picks + ' of ' + total + ' picks made, read ' + ago(picks.at) + '. '
              : 'Not read yet. '}
            <button type="button" className="link" disabled={busy} onClick={onCheck}>
              {busy ? 'Reading…' : 'Check again'}
            </button>
          </p>
          {picks?.picks === 0 && (
            <p className="hint">
              The draft is open and nobody has picked, so this run is the same as a mock
              from pick one.
            </p>
          )}
        </div>
      )}

      {error && <div className="banner is-bad"><span>{error}</span></div>}
    </>
  );
}
