// Relative path: packages/shared/cursor-auth/src/index.ts

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

// Schema for Cursor authentication state
const CursorAuthStateSchema = z.object({
  isAuthenticated: z.boolean(),
  lastChecked: z.string(),
  sessionCookies: z.array(z.object({
    name: z.string(),
    value: z.string(),
    domain: z.string(),
    path: z.string(),
    expires: z.number().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
  })).optional(),
  userAgent: z.string().optional(),
  lastLogin: z.string().optional(),
  expiresAt: z.string().optional(),
  source: z.enum(['stored_state', 'live_check']).optional(),
  error: z.string().optional(),
});

export type CursorAuthState = z.infer<typeof CursorAuthStateSchema>;

/**
 * CursorAuthManager
 *
 * Responsibility:
 * - Owns the canonical auth state file (`cursor.state.json`)
 * - Persists minimal, reusable auth data (e.g. cookies, timestamps)
 * - Persists minimal cookie state suitable for HTTP requests (no Playwright coupling)
 *
 * This intentionally does not know about uploaded session artifacts. Those are
 * higher-level inputs; the API route should distill them down into this state.
 */
export class CursorAuthManager {
  private statePath: string;

  constructor(stateDir: string = './data') {
    this.statePath = path.join(stateDir, 'cursor.state.json');
  }

  /**
   * Load the current authentication state
   */
  async loadState(): Promise<CursorAuthState | null> {
    try {
      if (!fs.existsSync(this.statePath)) {
        return null;
      }
      
      const content = await fs.promises.readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(content);
      return CursorAuthStateSchema.parse(parsed);
    } catch (error) {
      console.warn('Failed to load cursor auth state:', error);
      return null;
    }
  }

  /**
   * Save the authentication state
   */
  async saveState(state: CursorAuthState): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.statePath);
      await fs.promises.mkdir(dir, { recursive: true });
      
      // Validate state before saving
      const validatedState = CursorAuthStateSchema.parse(state);
      
      await fs.promises.writeFile(
        this.statePath, 
        JSON.stringify(validatedState, null, 2)
      );
    } catch (error) {
      console.error('Failed to save cursor auth state:', error);
      throw error;
    }
  }

  /**
   * Update authentication status
   */
  async updateAuthStatus(isAuthenticated: boolean, error?: string): Promise<void> {
    const currentState = await this.loadState();
    const newState: CursorAuthState = {
      ...(currentState || {}),
      isAuthenticated,
      lastChecked: new Date().toISOString(),
      source: 'live_check',
      ...(error ? { error } : {}),
    };

    if (!error && 'error' in (newState as any)) {
      delete (newState as any).error;
    }

    await this.saveState(newState);
  }

  // Note: Playwright-specific cookie save/apply helpers have been removed.

  /**
   * Save session cookies provided directly (no Playwright dependency)
   */
  async saveSessionCookiesRaw(cookies: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }>): Promise<void> {
    try {
      const normalized = (cookies || [])
        .filter(Boolean)
        .map((c) => ({
          name: String(c.name),
          value: String(c.value ?? ''),
          domain: String(c.domain ?? ''),
          path: String(c.path ?? '/'),
          ...(typeof c.expires === 'number' ? { expires: c.expires } : {}),
          ...(typeof c.httpOnly === 'boolean' ? { httpOnly: c.httpOnly } : {}),
          ...(typeof c.secure === 'boolean' ? { secure: c.secure } : {}),
          ...(c.sameSite ? { sameSite: c.sameSite } : {}),
        }));

      const currentState = await this.loadState();
      const newState: CursorAuthState = {
        ...(currentState || {}),
        isAuthenticated: true,
        lastChecked: new Date().toISOString(),
        sessionCookies: normalized,
        lastLogin: new Date().toISOString(),
        source: 'live_check',
      };

      if ('error' in (newState as any)) {
        delete (newState as any).error;
      }

      await this.saveState(newState);
    } catch (error) {
      console.error('Failed to save raw session cookies:', error);
      throw error;
    }
  }

  // Note: Playwright-specific cookie application has been removed.

  /**
   * Check if session is likely expired
   */
  async isSessionExpired(): Promise<boolean> {
    const state = await this.loadState();
    if (!state?.expiresAt) {
      return false;
    }
    
    return new Date() > new Date(state.expiresAt);
  }

  /**
   * Clear authentication state
   */
  async clearState(): Promise<void> {
    try {
      if (fs.existsSync(this.statePath)) {
        await fs.promises.unlink(this.statePath);
      }
    } catch (error) {
      console.warn('Failed to clear auth state:', error);
    }
  }

  /**
   * Get state file path
   */
  getStatePath(): string {
    return this.statePath;
  }
}
