// Relative path: apps/web/app/api/auth/upload-session/route.ts

import { NextResponse } from 'next/server';
import { sessionStore } from '../../../../lib/utils/file-session-store';
import { persistEncryptedSessionData, deriveRawCookiesFromSessionData, validateRawCookies, writeRawCookiesAtomic } from '../../../../../../packages/shared/cursor-auth/src';
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

    // Persist encrypted diagnostics-only copy in shared package
    try { await persistEncryptedSessionData(sessionData); } catch (e) { console.warn('persistEncryptedSessionData failed:', e); }

    // Derive raw cookies and validate against usage-summary before writing canonical state
    const derived = deriveRawCookiesFromSessionData(sessionData as any);
    let verification: any = { ok: false, status: null, hasUser: false, reason: 'not_run' };
    try {
      const apiProof = await validateRawCookies(derived);
      verification = { ok: apiProof.ok, status: apiProof.status ?? null, hasUser: apiProof.ok, reason: apiProof.reason ?? 'not_run' };
      if (apiProof.ok) {
        try {
          await writeRawCookiesAtomic(derived);
        } catch (e) {
          console.warn('Failed to write canonical state:', e);
        }
      }
    } catch (e) {
      console.error('Validation failed:', e);
      verification = { ok: false, status: null, hasUser: false, reason: `validation_error:${e instanceof Error ? e.message : String(e)}` };
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