import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Minimal logger and clock to mirror worker behavior
class ApiClock {
  now(): Date {
    return new Date();
  }
}

class ApiLogger {
  info(message: string, context: Record<string, unknown> = {}): void {
    console.info(message, context);
  }
  error(message: string, context: Record<string, unknown> = {}): void {
    console.error(message, context);
  }
}

function resolveStateDir(requestedStateDir: string): string {
  const requestedStatePath = path.join(path.resolve(requestedStateDir), 'cursor.state.json');
  if (fs.existsSync(requestedStatePath)) {
    return path.resolve(requestedStateDir);
  }

  let repoRoot = process.cwd();
  let foundRoot = false;
  for (let i = 0; i < 100; i++) {
    const marker1 = path.join(repoRoot, 'pnpm-workspace.yaml');
    const marker2 = path.join(repoRoot, 'turbo.json');
    const marker3 = path.join(repoRoot, '.git');
    if (fs.existsSync(marker1) || fs.existsSync(marker2) || fs.existsSync(marker3)) {
      foundRoot = true;
      break;
    }
    const parent = path.dirname(repoRoot);
    if (parent === repoRoot) break;
    repoRoot = parent;
  }
  if (!foundRoot) repoRoot = process.cwd();
  const alt = path.join(repoRoot, 'apps', 'web', 'data');
  const altStatePath = path.join(alt, 'cursor.state.json');
  if (fs.existsSync(altStatePath)) return alt;
  return requestedStateDir;
}

export async function POST() {
  try {
    const [{ runIngestion }, { CursorCsvFetchAdapter }, { PrismaUsageEventStore }, { PrismaBlobStore }] = await Promise.all([
      import('../../../../worker/src/workers/orchestrator'),
      import('../../../../worker/src/workers/scraper/infra/fetch'),
      import('../../../../worker/src/workers/scraper/infra/eventStore'),
      import('../../../../worker/src/workers/scraper/infra/blobStore'),
    ]);

    const logger = new ApiLogger();
    const clock = new ApiClock();
    const source = 'cursor_csv';

    const CURSOR_AUTH_STATE_DIR = process.env.CURSOR_AUTH_STATE_DIR || './data';
    const stateDir = resolveStateDir(CURSOR_AUTH_STATE_DIR);

    const fetcher = new CursorCsvFetchAdapter({ stateDir, logger });
    const eventStore = new PrismaUsageEventStore({ logger });
    const blobStore = new PrismaBlobStore({ logger });

    const result = await runIngestion({
      fetcher,
      eventStore,
      blobStore,
      clock,
      logger,
      source,
      blobPolicy: { mode: 'weekly' },
    });

    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (err) {
    console.error('api.scrape-once.inline.error', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}


