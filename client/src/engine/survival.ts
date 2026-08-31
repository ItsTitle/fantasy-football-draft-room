import { normalCdf } from './random';
import type { Player } from './types';

/**
 * The chance a player is still on the board when your next pick arrives.
 *
 * The model is the one the data already supports: the pick a player goes at is
 * normal around their ADP, with the spread Fantasy Football Calculator measures
 * across thousands of real drafts. The probability is conditioned on the player
 * being available right now, which matters for anyone falling past their ADP.
 * Without that conditioning a faller reads as zero per cent, which is the
 * opposite of the truth.
 *
 * It does not model this draft's own history. A run on running backs pulls the
 * real numbers down and this will not see it.
 */
export function survivalOdds(player: Player, currentPick: number, targetPick: number): number {
  if (targetPick <= currentPick) return 1;
  const sd = Math.max(0.8, player.adpStdev);
  const survivesTo = (pick: number) => 1 - normalCdf((pick - 0.5 - player.adp) / sd);

  const now = survivesTo(currentPick);
  const then = survivesTo(targetPick);
  if (now <= 1e-6) return then > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, then / now));
}
