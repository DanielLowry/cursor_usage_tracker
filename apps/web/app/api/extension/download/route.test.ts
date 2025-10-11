/* eslint-disable @typescript-eslint/no-var-requires */
/* Relative path: apps/web/app/api/extension/download/route.test.ts */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

describe('/api/extension/download', () => {
  const distZip = path.join(__dirname, '../../../../public/dist/cursor-session-helper.zip');

  beforeAll(() => {
    // Ensure icons exist and package extension using the project's packaging script.
    // Use paths relative to this test file so it works regardless of process.cwd().
    const gen = path.join(__dirname, '../../../../scripts/generate-icons.js');
    const pack = path.join(__dirname, '../../../../scripts/package-extension.js');
    execSync(`${process.execPath} ${gen}`, { stdio: 'inherit' });
    execSync(`${process.execPath} ${pack}`, { stdio: 'inherit' });
  });

  it('creates a zip at apps/web/public/dist and includes manifest and icons', () => {
    expect(fs.existsSync(distZip)).toBe(true);

    const Zip = require('node-stream-zip');
    const zip = new Zip.async({ file: distZip });

    return zip.entries().then((entries: any) => {
      const names = Object.keys(entries);
        // Expected files
        expect(names).toContain('manifest.json');
        expect(names).toContain('icons/icon16.png');
        expect(names).toContain('icons/icon48.png');
        expect(names).toContain('icons/icon128.png');
      return zip.close();
    });
  });
});


