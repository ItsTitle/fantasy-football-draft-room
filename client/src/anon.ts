/**
 * Anonymity, for screenshots and screen shares.
 *
 * Three things in this app identify real people: the names of your leagues,
 * their IDs, and the Sleeper display names of everyone in them. A league ID is
 * enough to look a league up, so masking the name alone would not be masking
 * anything. All three are replaced together or none of them are.
 *
 * Nothing here changes what is stored or what is sent. It is a display filter
 * and it can be turned off again without losing anything.
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A stable stand-in name for a league, by its place in your list. */
export function anonLeagueName(index: number): string {
  const letter = LETTERS[index % LETTERS.length];
  const wrap = Math.floor(index / LETTERS.length);
  return 'League ' + letter + (wrap ? String(wrap + 1) : '');
}

/** A league ID with everything identifying taken out. */
export function anonLeagueId(): string {
  return '••••••••••••••••';
}

/** A stand-in for a manager, with your own seat still marked as yours. */
export function anonManager(index: number, isYou: boolean): string {
  return isYou ? 'You' : 'Manager ' + (index + 1);
}

/**
 * What a seat is called on screen.
 *
 * A team name is as identifying as a manager name, and often more so, since
 * people put their own name in it. Both go behind the same switch.
 */
export function maskTeam(name: string, index: number, isYou: boolean, on: boolean): string {
  if (!on) return name;
  return isYou ? 'You' : 'Team ' + (index + 1);
}

/** Apply the filter, or do not, in one call. */
export function maskLeague(name: string, index: number, on: boolean): string {
  return on ? anonLeagueName(index) : name;
}

export function maskId(id: string, on: boolean): string {
  return on ? anonLeagueId() : id;
}
