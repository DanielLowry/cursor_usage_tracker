// Relative path: apps/web/app/api/auth/upload-session/route.ts

import { NextResponse } from 'next/server';
import { sessionStore } from '../../../../lib/utils/file-session-store';
import { runHttpLiveCheck } from '../status/helpers';
import fs from 'fs';
import path from 'path';

export async function POST(request: Request) {
  try {
    // CORS handling for the actual request
    const origin = request.headers.get('origin');
    const isChromeExtension = origin && origin.startsWith('chrome-extension://');

    // Ensure request is over HTTPS in production
    if (process.env.NODE_ENV === 'production' && request.headers.get('x-forwarded-proto') !== 'https') {
      return NextResponse.json({ error: 'HTTPS required' }, { status: 403 });
    }

    // CORS headers
    const responseHeaders: Record<string, string> = {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Set Allow-Origin based on request origin
    if (isChromeExtension) {
      responseHeaders['Access-Control-Allow-Origin'] = origin!;
    } else {
      responseHeaders['Access-Control-Allow-Origin'] = '*';
    }

    const body = await request.json();
    const { sessionData } = body;

    if (!sessionData) {
      return NextResponse.json({ error: 'No session data provided' }, { 
        status: 400,
        headers: responseHeaders 
      });
    }

    // Save the session to filesystem with encryption
    const sessionFilename = sessionStore.save(sessionData);

    // Server-side replay verification via HTTP check against usage-summary
    // Verification logic is centralized in `status/helpers.ts`.
    let verification: any = { ok: false, status: null, hasUser: false, reason: 'not_run' };
    try {
      const liveResult = await runHttpLiveCheck(sessionData as any);
      const reason = liveResult.reason ?? (("error" in liveResult && (liveResult as any).error) ? `error:${(liveResult as any).error}` : (liveResult.isAuthenticated ? 'ok' : 'user:null'));
      verification = {
        ok: !!liveResult.isAuthenticated,
        status: liveResult.status ?? null,
        hasUser: !!liveResult.hasUser,
        reason
      };
      // Persist a compact verification file next to the session file for auditing
      try {
        const sessionsDir = path.join(process.cwd(), 'sessions');
        const verificationFilename = sessionFilename + '.verification.json';
        fs.writeFileSync(path.join(sessionsDir, verificationFilename), JSON.stringify({ verification, checkedAt: new Date().toISOString() }), { encoding: 'utf8', mode: 0o600 });
      } catch (e) {
        console.warn('Failed to write verification file:', e);
      }
    } catch (e) {
      console.error('Verification delegation failed:', e);
      verification = { ok: false, status: null, hasUser: false, reason: `delegation:${e instanceof Error ? e.message : String(e)}` };
    }

    return NextResponse.json({ success: true, sessionFilename, verification }, { headers: responseHeaders });
  } catch (error) {
    console.error('Session upload failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Handle CORS preflight requests
export async function OPTIONS(request: Request) {
  const allowedOrigin = request.headers.get('origin');
  
  // Allow Chrome extension origins
  const isChromeExtension = allowedOrigin && allowedOrigin.startsWith('chrome-extension://');
  
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': isChromeExtension ? allowedOrigin : '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400', // Cache preflight response for 24 hours
    }
  });
}