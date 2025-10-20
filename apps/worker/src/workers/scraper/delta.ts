import type { NormalizedUsageEvent } from '@cursor-usage/ingest';

export function computeDeltaEvents(
  events: NormalizedUsageEvent[],
  latestCapturedAt: Date | null,
): NormalizedUsageEvent[] {
  if (!latestCapturedAt) return [...events];
  const cutoff = latestCapturedAt.getTime();
  return events.filter((event) => event.captured_at.getTime() > cutoff);
}
