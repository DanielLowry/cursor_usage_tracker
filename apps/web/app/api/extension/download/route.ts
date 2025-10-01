import fs from 'fs';
import path from 'path';
import { PassThrough, Readable as NodeReadable } from 'stream';
import { execFileSync } from 'child_process';
import archiver from 'archiver';
import { NextResponse } from 'next/server';

const CACHE_DIR = path.join(process.cwd(), 'public', 'dist');
const CACHE_PATH = path.join(CACHE_DIR, 'cursor-session-helper.zip');
const TMP_PATH = CACHE_PATH + '.tmp';

// Simple in-process lock for generation
let generatingPromise: Promise<void> | null = null;

// Threshold (ms) after which we consider regenerating after a download
const REGENERATE_AFTER_MS = 1000 * 60 * 5; // 5 minutes

async function generateAndCache() {
  // Ensure icons are present before creating the archive; if missing, run the
  // repo's icon generation script (sync) so the produced zip always contains
  // the required `icons/*` files referenced by the manifest.
    function ensureIconsExist() {
    const iconCheckPath = path.join(process.cwd(), 'apps', 'web', 'public', 'extension', 'icons', 'icon128.png');
    if (fs.existsSync(iconCheckPath)) return;

    try {
      // Path to the helper script that creates icons. Run with the current
      // Node executable to ensure same runtime.
      // Resolve the script path robustly: if CWD is the package folder (apps/web),
      // call the script from there; otherwise, reference it from the repository root.
      const cwd = process.cwd();
      const scriptPath = cwd.endsWith(path.join('apps', 'web'))
        ? path.join(cwd, 'scripts', 'generate-icons.js')
        : path.join(cwd, 'apps', 'web', 'scripts', 'generate-icons.js');
      console.log('[extension/download] Icons missing; running generator:', scriptPath);
      execFileSync(process.execPath, [scriptPath], { stdio: 'inherit' });
      console.log('[extension/download] Icon generation completed');
    } catch (err) {
      // Don't throw here; we'll surface an error later when archiver runs, but
      // log for diagnostics.
      console.error('[extension/download] Icon generation failed', err);
    }
  }

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  ensureIconsExist();

  const tmpStream = fs.createWriteStream(TMP_PATH);
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise<void>((resolve, reject) => {
    tmpStream.on('close', () => {
      try {
        fs.renameSync(TMP_PATH, CACHE_PATH);
      } catch (err) {
        return reject(err);
      }
      resolve();
    });
    tmpStream.on('error', (err) => reject(err));

    archive.on('error', (err) => reject(err));

    archive.pipe(tmpStream);
    archive.directory(path.join(process.cwd(), 'apps', 'web', 'public', 'extension'), false);
    archive.finalize().catch((err) => reject(err));
  });
}

export async function GET() {
  try {
    console.log('[extension/download] Request received: starting download handling');
    const requestStart = Date.now();
    // If cache exists and is fresh, return it immediately
    if (fs.existsSync(CACHE_PATH)) {
      const stats = fs.statSync(CACHE_PATH);
      const age = Date.now() - stats.mtimeMs;
      console.log(`[extension/download] Cache exists; age=${age}ms`);
      // If fresh, stream cached file and trigger background regen after download finishes
      if (age < REGENERATE_AFTER_MS) {
        const nodeStream = fs.createReadStream(CACHE_PATH);
        const stream = NodeReadable.toWeb(nodeStream as unknown as NodeReadable);
        console.log('[extension/download] Serving cached zip (fresh) to client');
        // Fire-and-forget regeneration after responding
        nodeStream.on('close', () => {
          // If no generation is in progress, start one in background
          if (!generatingPromise) {
            console.log('[extension/download] Scheduling background regeneration after cached download');
            generatingPromise = (async () => {
              try { console.log('[extension/download] Background regeneration started'); await generateAndCache(); console.log('[extension/download] Background regeneration finished'); } catch (e) { console.error('[extension/download] Background regeneration failed', e); } finally { generatingPromise = null; }
            })();
          }
        });

        return new Response(stream as unknown as BodyInit, {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="cursor-session-helper.zip"',
            'Cache-Control': 'public, max-age=3600'
          }
        });
      }
      // If stale, fall through to regenerate-and-stream
    }

    // If generation already in progress, wait for it and serve the cache if it appears
    if (generatingPromise) {
      try {
        console.log('[extension/download] Waiting for in-progress generation to complete');
        await generatingPromise;
        console.log('[extension/download] In-progress generation finished; checking for cache');
        if (fs.existsSync(CACHE_PATH)) {
          console.log('[extension/download] Serving cache produced by concurrent generation');
          const nodeStream = fs.createReadStream(CACHE_PATH);
          const web = NodeReadable.toWeb(nodeStream as unknown as NodeReadable);
          return new Response(web as unknown as BodyInit, {
            status: 200,
            headers: {
              'Content-Type': 'application/zip',
              'Content-Disposition': 'attachment; filename="cursor-session-helper.zip"'
            }
          });
        }
      } catch (err) {
        console.error('[extension/download] Error while waiting for generation', err);
        // continue to attempt streaming generation below
      }
    }

    // No cache or stale: generate and stream to client while writing to tmp cache
    console.log('[extension/download] No fresh cache available; starting generation and streaming to client');
    generatingPromise = (async () => {
      try { console.log('[extension/download] Background generateAndCache started'); await generateAndCache(); console.log('[extension/download] Background generateAndCache finished'); } catch (e) { console.error('[extension/download] Background generateAndCache failed', e); } finally { generatingPromise = null; }
    })();

    // Stream freshly-built archive directly to client
    const archive = archiver('zip', { zlib: { level: 9 } });
    const pass = new PassThrough();
    archive.pipe(pass);
    // Ensure icons exist for the on-the-fly stream path as well.
    try {
      const iconCheckPath = path.join(process.cwd(), 'apps', 'web', 'public', 'extension', 'icons', 'icon128.png');
      if (!fs.existsSync(iconCheckPath)) {
        const cwd = process.cwd();
        const scriptPath = cwd.endsWith(path.join('apps', 'web'))
          ? path.join(cwd, 'scripts', 'generate-icons.js')
          : path.join(cwd, 'apps', 'web', 'scripts', 'generate-icons.js');
        console.log('[extension/download] Icons missing for streaming; running generator:', scriptPath);
        execFileSync(process.execPath, [scriptPath], { stdio: 'inherit' });
      }
    } catch (err) {
      console.error('[extension/download] Failed to generate icons for streaming', err);
    }

    archive.directory(path.join(process.cwd(), 'apps', 'web', 'public', 'extension'), false);
    // Fire-and-forget finalize (we already kicked off background generateAndCache)
    archive.finalize().catch(() => {});

    // Convert Node stream to Web ReadableStream and return as Response
    const webStream = NodeReadable.toWeb(pass as unknown as NodeReadable);
    console.log('[extension/download] Streaming newly-created archive to client');
    return new Response(webStream as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="cursor-session-helper.zip"',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (err) {
    console.error('[extension/download] Failed to generate extension', err);
    return new NextResponse('Failed to generate extension', { status: 500 });
  }
}


