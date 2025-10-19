import prisma from './client';
import { stableHash } from '@cursor-usage/hash';
import { mapNetworkJson, type NormalizedUsageEvent } from '@cursor-usage/ingest';
import { createHash } from 'crypto';

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
        source: 'network_json',
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
    snapshot = await prisma.snapshot.create({
      data: {
        captured_at: input.capturedAt,
        billing_period_start: billingPeriodStart,
        billing_period_end: billingPeriodEnd,
        table_hash: tableHash,
        rows_count: normalizedEvents.length,
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
            source: 'network_json',
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
    // Build per-row identity hash for idempotent upsert
    const normalizedIdentity = [
      event.captured_at.toISOString(),
      (event.model || '').trim(),
      String(event.input_with_cache_write_tokens ?? 0),
      String(event.input_without_cache_write_tokens ?? 0),
      String(event.cache_read_tokens ?? 0),
      String(event.output_tokens ?? 0),
      String(event.total_tokens ?? 0),
      String(event.api_cost_cents ?? 0),
      String(event.cost_to_you_cents ?? 0),
      event.billing_period_start ? event.billing_period_start.toISOString().slice(0, 10) : '-',
      event.billing_period_end ? event.billing_period_end.toISOString().slice(0, 10) : '-',
    ].join('|');
    const rowHash = createHash('sha256').update(normalizedIdentity).digest('hex');

    const upserted = await prisma.usageEvent.upsert({
      where: { row_hash: rowHash },
      update: {},
      create: {
        captured_at: event.captured_at,
        model: event.model,
        row_hash: rowHash,
        input_with_cache_write_tokens: event.input_with_cache_write_tokens,
        input_without_cache_write_tokens: event.input_without_cache_write_tokens,
        cache_read_tokens: event.cache_read_tokens,
        output_tokens: event.output_tokens,
        total_tokens: event.total_tokens,
        api_cost_cents: event.api_cost_cents,
        cost_to_you_cents: event.cost_to_you_cents,
        billing_period_start: event.billing_period_start,
        billing_period_end: event.billing_period_end,
        source: 'network_json',
        raw_blob_id: event.raw_blob_id ?? undefined,
      },
      select: { id: true },
    });
    usageEventIds.push(upserted.id);
  }

  return {
    snapshotId: snapshot.id,
    wasNew: true,
    usageEventIds,
  };
}
