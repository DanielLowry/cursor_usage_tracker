import type { NormalizedUsageEvent } from '@cursor-usage/ingest';

export function computeDeltaEvents(
  normalizedEvents: NormalizedUsageEvent[],
  latestCapture: Date | null,
): NormalizedUsageEvent[] {
  if (!latestCapture) {
    return [...normalizedEvents];
  }
  const latestMillis = latestCapture.getTime();
  return normalizedEvents.filter((event) => event.captured_at.getTime() > latestMillis);
}
