// Relative path: apps/worker/src/workers/scraper/delta.ts
// Delta computation filters out events already persisted in the latest snapshot
// for a billing period, keeping only newly captured events.
import type { NormalizedUsageEvent } from './normalize';

/**
 * Returns events captured strictly after `maxExisting` (if provided).
 */
export function computeDeltaEvents(
  normalizedEvents: NormalizedUsageEvent[],
  maxExisting: Date | null,
): NormalizedUsageEvent[] {
  if (!maxExisting) return [...normalizedEvents];
  return normalizedEvents.filter((event) => event.captured_at > maxExisting);
}
