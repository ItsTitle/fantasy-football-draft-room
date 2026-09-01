import { useRef, useState } from 'react';
import type { NoteSet } from '../engine/types';

interface Props {
  notes: NoteSet | null;
  /** How many notes came from the ranking file rather than from here. */
  fromRankings: number;
  busy: boolean;
  onLoad: (csv: string, label: string) => void;
  onClear: () => void;
}

/**
 * Your own notes on players.
 *
 * Notes reach the board two ways. A ranking export can carry a notes column
 * and it is read where it is found, which costs you nothing when the file you
 * already upload happens to have one. This panel is the other way, and it
 * exists because those two things have different lifetimes: a ranking export
 * is replaced every time its publisher updates, and a note you wrote about a
 * player should outlive that. So a note loaded here wins over the same
 * player's note in a ranking file.
 */
export default function NotesPanel(props: Props) {
  const { notes, fromRankings, busy, onLoad, onClear } = props;

  const [pasted, setPasted] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => onLoad(String(reader.result || ''), file.name);
    reader.readAsText(file);
  };

  return (
    <>
      {!notes && (
        <>
          <p className="hint">
            A notes file is two columns: who the note is about, and the note. Name the second
            one Notes and put it last, so a note with a comma in it does not need quoting.
            Add Pos and Team columns if you have them: they are what lets an awkward spelling
            like Cameron Ward reach Cam Ward. Notes show under the player on the draft board.
            {fromRankings > 0 && (
              <>
                {' '}
                Your ranking file already carries
                {' ' + fromRankings + ' note' + (fromRankings === 1 ? '' : 's') + '. '}
                Anything you load here wins over it.
              </>
            )}
          </p>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="notes-file">Upload a file</label>
              <input
                id="notes-file"
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
              <label htmlFor="notes-paste">Or paste it</label>
              <textarea
                id="notes-paste"
                className="input"
                rows={4}
                value={pasted}
                placeholder={'Player,Pos,Team,Notes\nJa’Marr Chase,WR,CIN,Locked in at 1.01.'}
                onChange={(e) => setPasted(e.target.value)}
              />
              <button
                type="button"
                className="btn"
                disabled={!pasted.trim() || busy}
                onClick={() => onLoad(pasted, 'Pasted notes')}
              >
                Match these
              </button>
            </div>
          </div>
        </>
      )}

      {notes && (
        <>
          <div className="grid-2">
            <div>
              <p className="eyebrow">Loaded</p>
              <p style={{ margin: '2px 0 0' }}>{notes.label}</p>
              <p className="hint" style={{ marginTop: 6 }}>
                {notes.notes.length + ' note' + (notes.notes.length === 1 ? '' : 's')}
                {' read from '}
                <code className="mono">{notes.columns.note}</code>
                {fromRankings > 0
                  ? '. Your ranking file carries ' + fromRankings + ' more, which these override.'
                  : '.'}
              </p>
            </div>

            <div>
              <button type="button" className="btn" disabled={busy} onClick={onClear}>
                Remove these notes
              </button>
            </div>
          </div>

          {/*
            * A name that matched nothing is a note you wrote and will never
            * see. Saying so is the whole reason this list is here: the note is
            * not lost, it is just pointing at a player the board does not hold
            * under that spelling. Fix the spelling, or map the name once in
            * Your rankings and it carries here too.
            */}
          {notes.unmatched.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <p className="eyebrow">
                {notes.unmatched.length + ' name'
                  + (notes.unmatched.length === 1 ? '' : 's')
                  + ' matched nobody'}
              </p>
              <p className="hint">
                These notes are not on the board. Map the name once under Your rankings and it
                applies here as well.
              </p>
              <ul className="hint" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {notes.unmatched.slice(0, 12).map((u) => (
                  <li key={u.key}>
                    {u.name}
                    {u.suggestions.length > 0
                      ? ' — did you mean ' + u.suggestions.slice(0, 2).map((s) => s.name).join(' or ') + '?'
                      : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  );
}
