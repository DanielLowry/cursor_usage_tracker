import type { NormalizedUsageEvent } from '@cursor-usage/ingest';

export function computeDeltaEvents(
  events: NormalizedUsageEvent[],
  latestCapturedAt: Date | null,
): NormalizedUsageEvent[] {
  if (!latestCapturedAt) return [...events];
  return events.filter((event) => event.captured_at > latestCapturedAt);
}
