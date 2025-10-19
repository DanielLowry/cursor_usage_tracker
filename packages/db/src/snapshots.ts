import prisma from './client';
import { stableHash } from '@cursor-usage/hash';
import { mapNetworkJson, type NormalizedUsageEvent } from '@cursor-usage/ingest';
// crypto not needed for DB-level dedupe; we rely on composite unique constraint

export type SnapshotInput = {
  payload: unknown;
  capturedAt: Date;
  rawBlobId?: string | null;
};

export type SnapshotResult = {
  snapshotId: string | null;
  wasNew: boolean;
  usageEventIds: string[];
};

/**
 * Build a stable, sorted JSON view for snapshotting.
 * Includes billing period bounds in the hash input for uniqueness.
 */
function buildStableView(events: NormalizedUsageEvent[]): unknown {
  if (events.length === 0) {
    return { rows: [], billing_period: null };
  }

  // Sort events by model, then by total_tokens for deterministic ordering
  const sortedEvents = [...events].sort((a, b) => {
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    return a.total_tokens - b.total_tokens;
  });

  // Extract billing period from first event (all should have same period)
  const firstEvent = sortedEvents[0];
  const billingPeriod = {
    start: firstEvent.billing_period_start?.toISOString().split('T')[0] || null,
    end: firstEvent.billing_period_end?.toISOString().split('T')[0] || null,
  };

  // Build normalized rows for hashing
  const rows = sortedEvents.map((e) => ({
    model: e.model,
    kind: e.kind,
    max_mode: e.max_mode,
    input_with_cache_write_tokens: e.input_with_cache_write_tokens,
    input_without_cache_write_tokens: e.input_without_cache_write_tokens,
    cache_read_tokens: e.cache_read_tokens,
    output_tokens: e.output_tokens,
    total_tokens: e.total_tokens,
    api_cost_cents: e.api_cost_cents,
    api_cost_raw: (e as any).api_cost_raw ?? null,
  }));

  return {
    billing_period: billingPeriod,
    rows,
  };
}

/**
 * Create a snapshot if the data has changed, linking to usage events.
 */
export async function createSnapshotIfChanged(input: SnapshotInput): Promise<SnapshotResult> {
  // First, normalize the payload to usage events
  const normalizedEvents = mapNetworkJson(input.payload, input.capturedAt, input.rawBlobId);
  
  if (normalizedEvents.length === 0) {
    return { snapshotId: null, wasNew: false, usageEventIds: [] };
  }

  // Build stable view and compute hash
  const stableView = buildStableView(normalizedEvents);
  const tableHash = stableHash(stableView);

  // Extract billing period for snapshot
  const firstEvent = normalizedEvents[0];
  const billingPeriodStart = firstEvent.billing_period_start;
  const billingPeriodEnd = firstEvent.billing_period_end;

  // Check if snapshot with this hash already exists for this billing period
  const existingSnapshot = await prisma.snapshot.findFirst({
    where: {
      billing_period_start: billingPeriodStart,
      billing_period_end: billingPeriodEnd,
      table_hash: tableHash,
    },
  });

  if (existingSnapshot) {
    // No change - return existing snapshot
    const linkedEvents = await prisma.usageEvent.findMany({
      where: {
        captured_at: existingSnapshot.captured_at,
      },
      select: { id: true },
    });
    return {
      snapshotId: existingSnapshot.id,
      wasNew: false,
      usageEventIds: linkedEvents.map((e) => e.id),
    };
  }

  // Data has changed - try to create new snapshot. Handle race against
  // concurrent writers by catching unique-constraint violations and
  // returning the existing snapshot in that case.
  let snapshot;
  try {
    // Snapshot must reference the raw blob that originated this payload (if provided)
    snapshot = await (prisma as any).snapshot.create({
      data: {
        captured_at: input.capturedAt,
        billing_period_start: billingPeriodStart,
        billing_period_end: billingPeriodEnd,
        table_hash: tableHash,
        rows_count: normalizedEvents.length,
        raw_blob_id: input.rawBlobId ?? undefined,
        min_row_ts: normalizedEvents.reduce((min, e) => (min == null || e.captured_at < min ? e.captured_at : min), null as Date | null) ?? undefined,
        max_row_ts: normalizedEvents.reduce((max, e) => (max == null || e.captured_at > max ? e.captured_at : max), null as Date | null) ?? undefined,
      },
    });
  } catch (err: any) {
    // Prisma unique constraint error code is P2002. If another process
    // beat us to creating the snapshot, fetch and return that snapshot.
    if (err?.code === 'P2002') {
      const existing = await prisma.snapshot.findFirst({
        where: {
          billing_period_start: billingPeriodStart,
          billing_period_end: billingPeriodEnd,
          table_hash: tableHash,
        },
      });
      if (existing) {
    const linkedEvents = await prisma.usageEvent.findMany({
      where: {
        captured_at: existing.captured_at,
      },
      select: { id: true },
    });
        return {
          snapshotId: existing.id,
          wasNew: false,
          usageEventIds: linkedEvents.map((e) => e.id),
        };
      }
    }
    throw err;
  }

  // Insert usage events and return their ids
  const usageEventIds: string[] = [];
  for (const event of normalizedEvents) {
    // Use composite unique constraint on (captured_at, total_tokens) to dedupe
    // Attempt to create; if conflict occurs do nothing and fetch existing id.
    try {
      const created = await (prisma as any).usageEvent.create({
        data: {
          captured_at: event.captured_at,
          kind: event.kind ?? '',
          model: event.model,
          max_mode: event.max_mode ?? null,
          input_with_cache_write_tokens: event.input_with_cache_write_tokens,
          input_without_cache_write_tokens: event.input_without_cache_write_tokens,
          cache_read_tokens: event.cache_read_tokens,
          output_tokens: event.output_tokens,
          total_tokens: event.total_tokens,
          api_cost_cents: event.api_cost_cents,
          api_cost_raw: (event as any).api_cost_raw ?? null,
        },
        select: { id: true },
      });
      usageEventIds.push(created.id);
    } catch (err: any) {
      // Prisma unique constraint error code P2002 indicates existing row
      if (err?.code === 'P2002') {
        const existing = await prisma.usageEvent.findFirst({
          where: { captured_at: event.captured_at, total_tokens: event.total_tokens },
          select: { id: true },
        });
        if (existing) usageEventIds.push(existing.id);
        else throw err;
      } else {
        throw err;
      }
    }
  }

  return {
    snapshotId: snapshot.id,
    wasNew: true,
    usageEventIds,
  };
}

/**
 * Create a snapshot record for the given billing period and table_hash, and insert
 * only the provided delta normalized events into `usage_events` (to avoid re-inserting
 * the entire table). Returns the snapshot and inserted/linked usage event ids.
 */
export async function createSnapshotWithDelta(params: {
  billingPeriodStart: Date | null;
  billingPeriodEnd: Date | null;
  tableHash: string;
  totalRowsCount: number;
  capturedAt: Date;
  normalizedDeltaEvents: NormalizedUsageEvent[];
}): Promise<SnapshotResult> {
  const { billingPeriodStart, billingPeriodEnd, tableHash, totalRowsCount, capturedAt, normalizedDeltaEvents } = params;

  // Check for existing snapshot with same hash and billing period
  const existingSnapshot = await prisma.snapshot.findFirst({
    where: {
      billing_period_start: billingPeriodStart,
      billing_period_end: billingPeriodEnd,
      table_hash: tableHash,
    },
  });

  if (existingSnapshot) {
    const linkedEvents = await prisma.usageEvent.findMany({
      where: { captured_at: existingSnapshot.captured_at },
      select: { id: true },
    });
    return { snapshotId: existingSnapshot.id, wasNew: false, usageEventIds: linkedEvents.map((e) => e.id) };
  }

  // Create snapshot; handle races via unique constraint
  let snapshot;
  try {
    snapshot = await (prisma as any).snapshot.create({
      data: {
        captured_at: capturedAt,
        billing_period_start: billingPeriodStart,
        billing_period_end: billingPeriodEnd,
        table_hash: tableHash,
        rows_count: totalRowsCount,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      const existing = await prisma.snapshot.findFirst({
        where: { billing_period_start: billingPeriodStart, billing_period_end: billingPeriodEnd, table_hash: tableHash },
      });
      if (existing) {
        const linkedEvents = await prisma.usageEvent.findMany({ where: { captured_at: existing.captured_at }, select: { id: true } });
        return { snapshotId: existing.id, wasNew: false, usageEventIds: linkedEvents.map((e) => e.id) };
      }
    }
    throw err;
  }

  // Insert only delta events and collect their ids
  const usageEventIds: string[] = [];
  for (const event of normalizedDeltaEvents) {
    try {
      const created = await (prisma as any).usageEvent.create({
        data: {
          captured_at: event.captured_at,
          kind: event.kind ?? '',
          model: event.model,
          max_mode: event.max_mode ?? null,
          input_with_cache_write_tokens: event.input_with_cache_write_tokens,
          input_without_cache_write_tokens: event.input_without_cache_write_tokens,
          cache_read_tokens: event.cache_read_tokens,
          output_tokens: event.output_tokens,
          total_tokens: event.total_tokens,
          api_cost_cents: event.api_cost_cents,
          api_cost_raw: (event as any).api_cost_raw ?? null,
        },
        select: { id: true },
      });
      usageEventIds.push(created.id);
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const existing = await prisma.usageEvent.findFirst({ where: { captured_at: event.captured_at, total_tokens: event.total_tokens }, select: { id: true } });
        if (existing) usageEventIds.push(existing.id);
        else throw err;
      } else {
        throw err;
      }
    }
  }

  return { snapshotId: snapshot.id, wasNew: true, usageEventIds };
}
