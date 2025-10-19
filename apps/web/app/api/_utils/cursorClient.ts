// Relative path: apps/web/app/api/_utils/cursorClient.ts

import { getAuthHeaders } from '../../../../../packages/shared/cursor-auth/src';

export async function fetchLiveCsv(stateDir: string = './data', signal?: AbortSignal): Promise<string> {
  const headers = await getAuthHeaders(stateDir);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch('https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens', {
      method: 'GET',
      headers,
      signal: signal ?? controller.signal,
    });
    if (!res.ok) throw new Error(`csv fetch failed: status=${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 5 * 1024 * 1024) throw new Error('payload too large');
    return buf.toString('utf8');
  } finally {
    clearTimeout(timeout);
  }
}


