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
});

export type CursorAuthState = z.infer<typeof CursorAuthStateSchema>;

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
      isAuthenticated,
      lastChecked: new Date().toISOString(),
      ...currentState,
      ...(error && { error }),
    };
    
    await this.saveState(newState);
  }

  /**
   * Save session cookies from a Playwright context
   */
  async saveSessionCookies(context: any): Promise<void> {
    try {
      const cookies = await context.cookies();
      const currentState = await this.loadState();
      
      const newState: CursorAuthState = {
        isAuthenticated: true,
        lastChecked: new Date().toISOString(),
        sessionCookies: cookies,
        lastLogin: new Date().toISOString(),
        ...currentState,
      };
      
      await this.saveState(newState);
    } catch (error) {
      console.error('Failed to save session cookies:', error);
      throw error;
    }
  }

  /**
   * Apply saved cookies to a Playwright context
   */
  async applySessionCookies(context: any): Promise<void> {
    try {
      const state = await this.loadState();
      if (!state?.sessionCookies) {
        return;
      }

      await context.addCookies(state.sessionCookies);
    } catch (error) {
      console.warn('Failed to apply session cookies:', error);
    }
  }

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
