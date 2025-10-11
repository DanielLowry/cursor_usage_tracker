// Relative path: apps/web/app/api/healthz/route.ts

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ ok: true });
}
