// Relative path: apps/web/app/api/extension/download/route.ts

/*
  /api/extension/download

  This route generates and serves a packaged ZIP of the browser extension located
  at `apps/web/public/extension`. Usage:

  - GET: returns a ZIP archive named `cursor-session-helper.zip` containing the
    extension files. If a cached ZIP exists under `public/dist` and is fresh
    (configured by `REGENERATE_AFTER_MS`), it will be streamed immediately and
    a background regeneration will be scheduled after the response is sent.

  - If no fresh cache exists the route will stream a freshly-generated ZIP to
    the client while concurrently writing a cache file to `public/dist` for
    subsequent requests.

  Implementation notes:
  - Icons required by the extension are generated on-demand via the project's
    helper script if missing.
  - To avoid producing invalid/empty ZIPs, the generator checks that the
    extension directory contains at least one file before creating an archive
    and will abort with a clear error if empty.
*/
export const runtime = 'nodejs';

import fs from 'fs';
import path from 'path';
import { PassThrough, Readable as NodeReadable } from 'stream';
import { execFileSync } from 'child_process';
import archiver from 'archiver';
import { NextResponse } from 'next/server';

// Resolve paths referring to the web package robustly. When the process CWD is
// already the `apps/web` package this prevents doubling `apps/web` in joins.
function resolveWebPath(...segments: string[]): string {
  const cwd = process.cwd();
  const webRel = path.join('apps', 'web');
  // If we're already running with CWD ending in apps/web, use CWD directly
  if (cwd.endsWith(webRel)) return path.join(cwd, ...segments);
  // Prefer repository-root layout: <repo>/apps/web/...
  const candidate = path.join(cwd, 'apps', 'web', ...segments);
  if (fs.existsSync(candidate)) return candidate;
  // Fallback to joining from CWD
  return path.join(cwd, ...segments);
}

const CACHE_DIR = path.join(process.cwd(), 'public', 'dist');
const CACHE_PATH = path.join(CACHE_DIR, 'cursor-session-helper.zip');
const TMP_PATH = CACHE_PATH + '.tmp';

// Simple in-process lock for generation
let generatingPromise: Promise<void> | null = null;

// Threshold (ms) after which we consider regenerating after a download
const REGENERATE_AFTER_MS = 1000 * 60 * 5; // 5 minutes

// Helper: count files recursively under a directory (returns 0 if missing or empty)
function countFilesRecursively(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const p = path.join(dirPath, entry.name);
    if (entry.isDirectory()) total += countFilesRecursively(p);
    else if (entry.isFile()) total++;
  }
  return total;
}

// Helper: return a small sample of directory entries (top-level names, mark
// directories with a trailing slash). Returns empty array on error or missing dir.
function getDirectorySample(dirPath: string, maxEntries = 10): string[] {
  try {
    if (!fs.existsSync(dirPath)) return [];
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    return items.slice(0, maxEntries).map((it) => (it.isDirectory() ? `${it.name}/` : it.name));
  } catch (err) {
    console.error('[extension/download] Failed to sample directory', dirPath, err);
    return [];
  }
}

async function generateAndCache() {
  // Ensure icons are present before creating the archive; if missing, run the
  // repo's icon generation script (sync) so the produced zip always contains
  // the required `icons/*` files referenced by the manifest.
    function ensureIconsExist() {
    const iconCheckPath = resolveWebPath('public', 'extension', 'icons', 'icon128.png');
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

  if (!fs.existsSync(CACHE_DIR)) {
    console.log('[extension/download] Cache dir missing; creating:', CACHE_DIR);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } else {
    console.log('[extension/download] Cache dir exists:', CACHE_DIR);
  }
  ensureIconsExist();

  const tmpStream = fs.createWriteStream(TMP_PATH);
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise<void>((resolve, reject) => {
    console.log('[extension/download] Beginning archive creation to tmp path:', TMP_PATH);
    tmpStream.on('close', () => {
      console.log('[extension/download] tmp stream closed; attempting to rename tmp -> cache');
      try {
        fs.renameSync(TMP_PATH, CACHE_PATH);
        console.log('[extension/download] Cache successfully written:', CACHE_PATH);
      } catch (err) {
        console.error('[extension/download] Failed to rename tmp file to cache', err);
        return reject(err);
      }
      resolve();
    });
    tmpStream.on('error', (err) => {
      console.error('[extension/download] tmpStream error', err);
      reject(err);
    });

    archive.on('error', (err) => {
      console.error('[extension/download] archiver error', err);
      reject(err);
    });

    archive.on('warning', (warn) => {
      console.warn('[extension/download] archiver warning', warn);
    });

    archive.pipe(tmpStream);
    const addPath = resolveWebPath('public', 'extension');
    console.log('[extension/download] Adding directory to archive:', addPath);
    const addPathFileCount = countFilesRecursively(addPath);
    console.log('[extension/download] Cache-generation source dir check:', { addPath, exists: fs.existsSync(addPath), fileCount: addPathFileCount, sample: getDirectorySample(addPath) });
    if (addPathFileCount === 0) {
      const err = new Error('No files found to add to archive; aborting zip creation');
      console.error('[extension/download] ' + err.message);
      // Ensure streams/archiver are cleaned up before rejecting
      try { archive.destroy(); } catch (e) { /* ignore */ }
      try { tmpStream.destroy(); } catch (e) { /* ignore */ }
      return reject(err);
    }
    archive.directory(addPath, false);
    try {
      const finalizeResult = archive.finalize();
      if (finalizeResult && typeof (finalizeResult as any).then === 'function') {
        (finalizeResult as any).catch((err: any) => {
          console.error('[extension/download] archive.finalize() promise rejected', err);
          reject(err);
        });
      }
    } catch (err) {
      // Some archiver versions throw synchronously or return void; ensure we
      // surface those errors to the promise consumer.
      console.error('[extension/download] archive.finalize() threw synchronously', err);
      reject(err);
    }
  });
}

export async function GET() {

  console.log('[extension/download] Request received: starting download handling');
  try {
    console.log('[extension/download] Request received: starting download handling');
    const requestStart = Date.now();
    console.log('[extension/download] Current PID:', process.pid, 'CWD:', process.cwd());
    // If cache exists and is fresh, return it immediately
    if (fs.existsSync(CACHE_PATH)) {
      const stats = fs.statSync(CACHE_PATH);
      const age = Date.now() - stats.mtimeMs;
      console.log(`[extension/download] Cache exists; path=${CACHE_PATH}; size=${stats.size}; age=${age}ms`);
      // If fresh, stream cached file and trigger background regen after download finishes
      if (age < REGENERATE_AFTER_MS) {
        const nodeStream = fs.createReadStream(CACHE_PATH);
        nodeStream.on('error', (err) => console.error('[extension/download] Error reading cached file stream', err));
        nodeStream.on('open', () => console.log('[extension/download] Opened cached file stream for reading')); 
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
      const iconCheckPath = resolveWebPath('public', 'extension', 'icons', 'icon128.png');
      if (!fs.existsSync(iconCheckPath)) {
        const cwd = process.cwd();
        const scriptPath = cwd.endsWith(path.join('apps', 'web'))
          ? path.join(cwd, 'scripts', 'generate-icons.js')
          : path.join(cwd, 'apps', 'web', 'scripts', 'generate-icons.js');
        console.log('[extension/download] Icons missing for streaming; running generator:', scriptPath);
        execFileSync(process.execPath, [scriptPath], { stdio: 'inherit' });
        console.log('[extension/download] Icon generation completed for streaming');
      } else {
        console.log('[extension/download] Icons present for streaming at', iconCheckPath);
      }
    } catch (err) {
      console.error('[extension/download] Failed to generate icons for streaming', err);
    }

    const streamAddPath = resolveWebPath('public', 'extension');
    const streamPathFileCount = countFilesRecursively(streamAddPath);
    console.log('[extension/download] Streaming-source dir check:', { streamAddPath, exists: fs.existsSync(streamAddPath), fileCount: streamPathFileCount, sample: getDirectorySample(streamAddPath) });
    if (streamPathFileCount === 0) {
      const err = new Error('No files found to add to streaming archive; aborting streaming zip creation');
      console.error('[extension/download] ' + err.message);
      try { archive.destroy(); } catch (e) { /* ignore */ }
      throw err;
    }
    archive.directory(streamAddPath, false);
    console.log('[extension/download] Added directory to streaming archive:', streamAddPath);
    // Fire-and-forget finalize (we already kicked off background generateAndCache)
    try {
      const finalizeResult = archive.finalize();
      if (finalizeResult && typeof (finalizeResult as any).then === 'function') {
        // Swallow finalize rejection for streaming path; generation errors are
        // already logged elsewhere. We still guard against synchronous throws.
        (finalizeResult as any).catch((err: any) => console.error('[extension/download] archive.finalize() rejected during streaming', err));
      }
    } catch (err) {
      // Ignore synchronous finalize errors for streaming path but log for visibility.
      console.error('[extension/download] archive.finalize() threw synchronously during streaming', err);
    }

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


