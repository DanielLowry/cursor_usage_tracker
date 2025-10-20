import type { NormalizedUsageEvent } from '@cursor-usage/ingest';

export function computeDeltaEvents(
  normalizedEvents: NormalizedUsageEvent[],
  maxExisting: Date | null,
): NormalizedUsageEvent[] {
  if (!maxExisting) return [...normalizedEvents];
  return normalizedEvents.filter((event) => event.captured_at > maxExisting);
}
