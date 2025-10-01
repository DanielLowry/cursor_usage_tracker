import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    // Ensure request is over HTTPS in production
    if (process.env.NODE_ENV === 'production' && request.headers.get('x-forwarded-proto') !== 'https') {
      return NextResponse.json({ error: 'HTTPS required' }, { status: 403 });
    }

    const body = await request.json();
    const { sessionData } = body;

    if (!sessionData) {
      return NextResponse.json({ error: 'No session data provided' }, { status: 400 });
    }

    // Encrypt the session data using AES-256-GCM (Node built-in crypto)
    const ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY;
    if (!ENCRYPTION_KEY) {
      console.error('SESSION_ENCRYPTION_KEY not set');
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
    }

    const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
    if (keyBuffer.length !== 32) {
      console.error('SESSION_ENCRYPTION_KEY must be 32 bytes (hex-encoded)');
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Session upload failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}