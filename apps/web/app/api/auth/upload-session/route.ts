import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CursorAuthManager } from '../../../../../../packages/shared/cursor-auth/src';

const envSchema = z.object({
  CURSOR_AUTH_STATE_DIR: z.string().min(1).default('./data'),
});

// Schema for session data that can be uploaded
const SessionUploadSchema = z.object({
  session: z.string().optional(), // Legacy single session cookie
  sessionData: z.object({
    cookies: z.array(z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      path: z.string(),
      expires: z.number().optional(),
      httpOnly: z.boolean().optional(),
      secure: z.boolean().optional(),
      sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
    })).optional(),
    localStorage: z.record(z.string()).optional(),
    sessionStorage: z.record(z.string()).optional(),
    userAgent: z.string().optional(),
  }).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: `Invalid environment: ${parsed.error.message}`
      }, { status: 500 });
    }
    const env = parsed.data;
    const authManager = new CursorAuthManager(env.CURSOR_AUTH_STATE_DIR);

    const body = await request.json();
    const sessionData = SessionUploadSchema.parse(body);

    if (sessionData.sessionData) {
      // New format: full session data with cookies and storage
      const { cookies, localStorage, sessionStorage, userAgent } = sessionData.sessionData;
      
      const newState = {
        isAuthenticated: true,
        lastChecked: new Date().toISOString(),
        sessionCookies: cookies || [],
        lastLogin: new Date().toISOString(),
        userAgent: userAgent,
        source: 'uploaded_session' as const,
      };

      await authManager.saveState(newState);
      
      return NextResponse.json({
        success: true,
        message: 'Session data uploaded and saved successfully'
      });
    } else if (sessionData.session) {
      // Legacy format: single session cookie
      const sessionCookie = {
        name: 'session',
        value: sessionData.session,
        domain: '.cursor.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax' as const,
      };

      const newState = {
        isAuthenticated: true,
        lastChecked: new Date().toISOString(),
        sessionCookies: [sessionCookie],
        lastLogin: new Date().toISOString(),
        source: 'uploaded_session' as const,
      };

      await authManager.saveState(newState);
      
      return NextResponse.json({
        success: true,
        message: 'Session cookie uploaded and saved successfully'
      });
    } else {
      return NextResponse.json({
        success: false,
        error: 'No session data provided'
      }, { status: 400 });
    }

  } catch (error) {
    console.error('Upload session failed:', error);
    return NextResponse.json({
      success: false,
      error: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }, { status: 500 });
  }
}
