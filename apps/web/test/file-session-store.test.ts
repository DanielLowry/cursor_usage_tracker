import fs from 'fs';
import os from 'os';
import path from 'path';
import { FileSessionStore } from '../lib/utils/file-session-store';

const TEST_KEY = 'a'.repeat(64); // 32 bytes hex

describe('FileSessionStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'));
  });

  afterEach(() => {
    // cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('save/read roundtrip without encryption', () => {
    const store = new FileSessionStore(tmpDir);
    const payload = { user: 'alice' };

    const filename = store.save(payload, false);
    expect(filename).toMatch(/^session_[0-9a-f]{32}\.json$/);

    const read = store.readSessionFile();
    expect(read).not.toBeNull();
    expect(read!.data.user).toBe(payload.user);
  });

  test('save/read roundtrip with encryption', () => {
    process.env.SESSION_ENCRYPTION_KEY = TEST_KEY;
    const store = new FileSessionStore(tmpDir);
    const payload = { user: 'bob', createdAt: new Date().toISOString() };

    const filename = store.save(payload, true);
    expect(filename).toMatch(/^session_[0-9a-f]{32}\.json$/);

    const raw = fs.readFileSync(path.join(tmpDir, filename), 'utf8');
    const parsed = JSON.parse(raw);
    // file should have ciphertext fields
    expect(parsed.ciphertext).toBeDefined();
    expect(parsed.iv).toBeDefined();
    expect(parsed.tag).toBeDefined();

    const read = store.readSessionFile();
    expect(read).not.toBeNull();
    expect(read!.data).toMatchObject(payload);

    delete process.env.SESSION_ENCRYPTION_KEY;
  });
});
