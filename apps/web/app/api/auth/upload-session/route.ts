import { NextResponse } from 'next/server';
import { createSecretKey } from 'crypto';
import { seal } from '@noble/ciphers/aes-gcm';

// Get encryption key from environment
const ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('SESSION_ENCRYPTION_KEY environment variable not set');
}

// Convert hex key to Uint8Array
const key = createSecretKey(Buffer.from(ENCRYPTION_KEY, 'hex'));

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

    // Encrypt the session data
    const dataToEncrypt = JSON.stringify(sessionData);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const encryptedData = await seal(
      key,
      nonce,
      new TextEncoder().encode(dataToEncrypt)
    );

    // Store the encrypted data (implement your storage solution here)
    // For example, save to a database:
    // await db.sessions.create({
    //   data: {
    //     encryptedData: Buffer.from(encryptedData).toString('base64'),
    //     nonce: Buffer.from(nonce).toString('base64'),
    //     createdAt: new Date()
    //   }
    // });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Session upload failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}