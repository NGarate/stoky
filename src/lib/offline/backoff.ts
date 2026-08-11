/**
 * How long to wait before trying a queued change again.
 *
 * Full jitter — a random point in `[0, ceiling)` rather than the ceiling
 * itself — because the failure this defends against is correlated. Three
 * phones in one household rejoin the same wifi at the same instant when
 * someone gets home, and plain exponential backoff has them all retry
 * together, fail together, and double together. Spreading them costs nothing
 * and is the difference between a queue that drains and one that thunders.
 *
 * `random` is injected so the shape can be tested rather than sampled.
 */

/** Never wait longer than this between attempts. */
export const MAX_DELAY_MS = 30_000;

/** The wait before attempt `attempts + 1`, in milliseconds. */
export function backoffDelay(
  attempts: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(MAX_DELAY_MS, 1_000 * 2 ** Math.max(0, attempts));
  return Math.floor(random() * ceiling);
}
