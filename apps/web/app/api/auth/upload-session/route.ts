// Relative path: apps/web/app/api/auth/upload-session/route.ts

import { NextResponse } from 'next/server';
// import { sessionStore } from '../../../../lib/utils/file-session-store'; // Removed as per plan
import {
  persistEncryptedSessionData,
  deriveRawCookiesFromSessionData,
  validateRawCookies,
  writeRawCookiesAtomic,
} from '../../../../../../packages/shared/cursor-auth/src';

function isLanHostname(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') return true;
  if (normalized.endsWith('.local')) return true;
  if (/^10\./.test(normalized)) return true;
  if (/^192\.168\./.test(normalized)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(normalized)) return true;
  if (/^169\.254\./.test(normalized)) return true;
  if (/^fc[0-9a-f]{2}/.test(normalized) || /^fd[0-9a-f]{2}/.test(normalized)) return true; // IPv6 unique-local
  return false;
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin') ?? '';
  const isChromeExtension = origin.startsWith('chrome-extension://');

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Origin': isChromeExtension ? origin : '*',
  };

  try {
    const url = new URL(request.url);
    const forwardedFor = request.headers.get('x-forwarded-for');
    const candidates = [
      url.hostname,
      ...(forwardedFor ? forwardedFor.split(',').map((part) => part.trim()).filter(Boolean) : []),
    ];
    const isLanRequest = candidates.some((host) => isLanHostname(host));

    if (!isLanRequest) {
      return NextResponse.json(
        { error: 'Session uploads are only accepted from the local network' },
        { status: 403, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const { sessionData } = body;

    if (!sessionData) {
      return NextResponse.json({ error: 'No session data provided' }, {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Save the session to filesystem with encryption for diagnostics
    const sessionFilename = await persistEncryptedSessionData(sessionData);

    // Derive raw cookies and validate against usage-summary before writing canonical state
    const derived = deriveRawCookiesFromSessionData(sessionData);
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

    return NextResponse.json({ success: true, sessionFilename, verification }, { headers: corsHeaders });
  } catch (error) {
    console.error('Session upload failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
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
