import { useState } from 'react';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  /** What this section is currently set to, in one short line. */
  summary?: ReactNode;
  /** A sentence under the heading. Shown only when the section is open. */
  note?: ReactNode;
  /** Full width on a desktop. */
  wide?: boolean;
  /** Whether this section collapses. False on a desktop, where all of it fits. */
  collapsible: boolean;
  /** Open before you touch it. The league you draft in is; the dials are not. */
  startOpen?: boolean;
  children: ReactNode;
}

/**
 * One settings section.
 *
 * On a desktop this is the panel it always was: a heading, a reading of the
 * current state, and the controls under it.
 *
 * On a phone the same section closes. Six open panels came to four thousand
 * pixels of scrolling, which is five screens of a phone spent looking for the
 * one control you came for. Closed, each section is a row that states what it
 * is set to, so the whole of the settings fits on one screen and you open the
 * one you meant. The summary is the point: a row of closed drawers labelled
 * only by name would make you open all six to find out anything.
 */
export default function Section(props: Props) {
  const { title, summary, note, wide, collapsible, startOpen, children } = props;
  const [open, setOpen] = useState(!!startOpen);
  const shown = !collapsible || open;

  return (
    <section
      className={'panel' + (wide ? ' span-2' : '') + (collapsible ? ' is-foldable' : '')}
      data-open={shown}
    >
      {collapsible ? (
        <h2 className="panel-head">
          <button type="button" className="fold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span className="eyebrow">{title}</span>
            {summary != null && <span className="fold-state">{summary}</span>}
            <span className="fold-caret" aria-hidden="true">{open ? '−' : '+'}</span>
          </button>
        </h2>
      ) : (
        <div className="panel-head">
          <h2 className="eyebrow">{title}</h2>
          {summary != null && <span className="hint mono">{summary}</span>}
        </div>
      )}

      {shown && (
        <div className="setup-body">
          {note != null && <p className="hint">{note}</p>}
          {children}
        </div>
      )}
    </section>
  );
}
