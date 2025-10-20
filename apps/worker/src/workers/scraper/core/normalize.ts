import type { UsageCsvPayload } from './csv';
import { parseUsageCsv } from './csv';

export type CapturedKind = 'html' | 'network_json';

export type CapturedPayload = {
  url?: string;
  payload: Buffer;
  kind: CapturedKind;
};

export function parseCapturedPayload(item: CapturedPayload): UsageCsvPayload | unknown | null {
  if (item.kind === 'network_json') {
    try {
      return JSON.parse(item.payload.toString('utf8'));
    } catch {
      return null;
    }
  }

  try {
    const csvText = item.payload.toString('utf8');
    return parseUsageCsv(csvText);
  } catch {
    return null;
  }
}
