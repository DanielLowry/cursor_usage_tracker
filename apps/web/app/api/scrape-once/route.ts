import { NextResponse } from 'next/server';
import { Queue } from 'bullmq';

// Lazy import to avoid issues during build without redis
async function getQueue(): Promise<Queue> {
  const { getRedis } = await import('@cursor-usage/redis');
  const connection = getRedis();
  return new Queue('scraper', { connection });
}

export async function POST() {
  try {
    const queue = await getQueue();
    await queue.add('scrape-once', { requestedAt: Date.now() }, { removeOnComplete: 20, removeOnFail: 50 });
    return NextResponse.json({ enqueued: true }, { status: 202 });
  } catch (err) {
    console.error('api.scrape-once.enqueue.error', err);
    return NextResponse.json({ enqueued: false, error: 'failed to enqueue scrape' }, { status: 500 });
  }
}


