import type {
  Board, LeagueImport, LeagueMember, LeagueSetup, LivePicks, LiveDraftState, Overrides,
  RankingSet,
} from './engine/types';

const BASE = import.meta.env.VITE_API_BASE || '/api';

export interface BoardQuery {
  scoring: string;
  teams: number;
  adpSource: string;
  year: number;
  force?: boolean;
}

function query(q: BoardQuery): string {
  const p = new URLSearchParams({
    scoring: q.scoring,
    teams: String(q.teams),
    adpSource: q.adpSource,
    year: String(q.year),
  });
  if (q.force) p.set('force', '1');
  return p.toString();
}

async function fail(res: Response): Promise<never> {
  let detail = res.statusText;
  try {
    const body = await res.json();
    detail = body.error || detail;
  } catch { /* The body was not JSON. Keep the status text. */ }
  throw new Error(detail);
}

export async function fetchBoard(q: BoardQuery, signal?: AbortSignal): Promise<Board> {
  const res = await fetch(BASE + '/board?' + query(q), { signal });
  if (!res.ok) return fail(res);
  return res.json();
}

export async function matchRankings(
  q: BoardQuery,
  csv: string,
  label: string,
  overrides: Overrides,
  rankColumn: number | null,
): Promise<RankingSet> {
  const res = await fetch(BASE + '/rankings?' + query(q), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csv, overrides, rankColumn }),
  });
  if (!res.ok) return fail(res);
  const body = await res.json();
  return { ...body, label };
}

/** The seats, team names, declared keepers and draft state of a real league. */
export async function fetchLeagueSetup(
  leagueId: string,
  q: BoardQuery,
  force = false,
): Promise<LeagueSetup> {
  const res = await fetch(
    BASE + '/sleeper/league/' + encodeURIComponent(leagueId) + '/setup?' + query(q)
      + (force ? '&force=1' : ''),
  );
  if (!res.ok) return fail(res);
  return res.json();
}

/** The managers in a league, so you can say which team is yours. */
export async function fetchLeagueMembers(leagueId: string): Promise<LeagueMember[]> {
  const res = await fetch(BASE + '/sleeper/league/' + encodeURIComponent(leagueId) + '/users');
  if (!res.ok) return fail(res);
  return res.json();
}

/** Whether a real draft has opened, and who sits in which slot. */
export async function fetchDraftState(draftId: string): Promise<LiveDraftState> {
  const res = await fetch(BASE + '/sleeper/draft/' + encodeURIComponent(draftId));
  if (!res.ok) return fail(res);
  return res.json();
}

/** Every pick made in a real draft so far, mapped onto this board. */
export async function fetchDraftPicks(draftId: string, q: BoardQuery): Promise<LivePicks> {
  const res = await fetch(
    BASE + '/sleeper/draft/' + encodeURIComponent(draftId) + '/picks?' + query(q),
    { cache: 'no-store' },
  );
  if (!res.ok) return fail(res);
  return res.json();
}

/**
 * Read draft settings out of a real Sleeper league.
 * `force` skips the service cache, which is what Refresh is for.
 */
export async function fetchSleeperLeague(id: string, force = false): Promise<LeagueImport> {
  const res = await fetch(BASE + '/sleeper/league/' + encodeURIComponent(id.trim())
    + (force ? '?force=1' : ''));
  if (!res.ok) return fail(res);
  return res.json();
}
