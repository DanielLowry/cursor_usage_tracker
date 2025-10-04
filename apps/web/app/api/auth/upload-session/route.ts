import { NextResponse } from 'next/server';
import crypto from 'crypto';

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

    // Encrypt the session data using AES-256-GCM (Node built-in crypto)
    const ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY;
    if (!ENCRYPTION_KEY) {
      console.error('SESSION_ENCRYPTION_KEY not set');
      return NextResponse.json({ error: 'Server not configured - no encryption key provided' }, { 
        status: 500,
        headers: responseHeaders 
      });
    }

    const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
    if (keyBuffer.length !== 32) {
      console.error('SESSION_ENCRYPTION_KEY must be 32 bytes (hex-encoded)');
      return NextResponse.json({ error: 'Server misconfigured' }, { 
        status: 500,
        headers: responseHeaders 
      });
    }

    const dataToEncrypt = JSON.stringify(sessionData);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
    const encrypted = Buffer.concat([cipher.update(dataToEncrypt, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const payload = {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: authTag.toString('base64'),
      createdAt: new Date().toISOString()
    };

    // Store the encrypted data (implement your storage solution here)
    // Example placeholder:
    // await db.sessions.create({ data: { payload: JSON.stringify(payload) } });

    return NextResponse.json({ success: true }, { 
      headers: responseHeaders 
    });
  } catch (error) {
    console.error('Session upload failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}