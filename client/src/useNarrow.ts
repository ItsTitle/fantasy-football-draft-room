import { useEffect, useState } from 'react';

/** The width below which the app lays itself out for a phone. */
export const NARROW = '(max-width: 880px)';

/**
 * Whether the screen is narrow enough to need the phone layout.
 *
 * Most of the responsive work in this app is CSS, and CSS is the right place
 * for it. This exists for the one thing CSS cannot do: on a phone the settings
 * sections are closed until you open them, and a closed section has to be
 * closed in the markup, not merely hidden, or every control inside it stays in
 * the tab order and every list inside it still renders.
 */
export default function useNarrow(query: string = NARROW): boolean {
  const [narrow, setNarrow] = useState(
    () => (typeof window === 'undefined' ? false : window.matchMedia(query).matches),
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const listen = () => setNarrow(media.matches);
    listen();
    media.addEventListener('change', listen);
    return () => media.removeEventListener('change', listen);
  }, [query]);

  return narrow;
}
