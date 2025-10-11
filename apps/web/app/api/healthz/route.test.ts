/**
 * Relative path: apps/web/app/api/healthz/route.test.ts
 *
 * Test Purpose:
 * - Validates that the health check API route responds with a JSON payload `{ ok: true }`, signalling the
 *   service is operational.
 *
 * Assumptions:
 * - The `GET` handler is synchronous/asynchronous callable without additional dependencies or request context.
 *
 * Expected Outcome & Rationale:
 * - The JSON response matches `{ ok: true }`, providing a simple regression test that prevents accidental
 *   changes to the health check contract used by external monitors.
 */
import { describe, it, expect } from 'vitest';
import { GET } from './route';

describe('/api/healthz', () => {
  it('returns { ok: true }', async () => {
    const response = await GET();
    const data = await response.json();
    expect(data).toEqual({ ok: true });
  });
});
