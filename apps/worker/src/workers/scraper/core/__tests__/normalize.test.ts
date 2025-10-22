import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseUsageCsv } from '../csv';
import { parseCapturedPayload } from '../normalize';

describe('parseCapturedPayload', () => {
  const csvFixture = resolve(__dirname, '../../../../../../../tests/fixtures/csv/sample1.csv');
  const networkFixture = resolve(__dirname, '../../../../../../../tests/fixtures/network/sample1.json');

  it('parses network json payloads as structured objects', () => {
    const json = readFileSync(networkFixture, 'utf8');
    const parsed = parseCapturedPayload({ payload: Buffer.from(json, 'utf8'), kind: 'network_json' });

    expect(parsed).toEqual(JSON.parse(json));
  });

  it('parses html csv payloads via csv parser', () => {
    const csv = readFileSync(csvFixture);
    const parsed = parseCapturedPayload({ payload: csv, kind: 'html' });
    const expected = parseUsageCsv(csv.toString('utf8'));

    expect(parsed).toEqual(expected);
  });

  it('returns null when json payload cannot be parsed', () => {
    const parsed = parseCapturedPayload({ payload: Buffer.from('not json'), kind: 'network_json' });

    expect(parsed).toBeNull();
  });
});
