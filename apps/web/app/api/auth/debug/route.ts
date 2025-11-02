import { NextResponse } from 'next/server';
import { AuthSession } from '../../../../../../packages/shared/cursor-auth/src/AuthSession';

// Always reflect the current session state, not a cached copy
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const authSession = new AuthSession();
    const preview = await authSession.preview();

    return NextResponse.json({
      success: true,
      ...preview,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting auth debug info:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
