import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export class FileSessionStore {
  private sessionsDir: string;

  constructor(customPath?: string) {
    // Allow custom path for flexibility, default to project sessions directory
    this.sessionsDir = customPath || path.join(process.cwd(), 'sessions');
    
    try {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
      console.log(`Sessions directory initialized: ${this.sessionsDir}`);
    } catch (error) {
      console.error('Failed to create sessions directory:', error);
    }
  }

  // Save encrypted session
  save(encryptedPayload: any) {
    try {
      // Remove all existing session files before saving new one
      this.removeAllSessions();

      // Generate unique filename
      const filename = `session_${crypto.randomBytes(16).toString('hex')}.json`;
      const filePath = path.join(this.sessionsDir, filename);

      // Prepare logging details
      const fileSize = Buffer.byteLength(JSON.stringify(encryptedPayload), 'utf8');
      const logDetails = {
        filename,
        timestamp: new Date().toISOString(),
        payloadSize: fileSize
      };

      // Write with secure permissions
      fs.writeFileSync(filePath, JSON.stringify(encryptedPayload), {
        encoding: 'utf8',
        mode: 0o600 // Read/write only for owner
      });

      // Log successful file save
      console.log('Session file saved:', JSON.stringify(logDetails, null, 2));

      return filename;
    } catch (error) {
      console.error('Failed to save session file:', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  // Remove all existing session files
  private removeAllSessions() {
    try {
      const files = fs.readdirSync(this.sessionsDir)
        .filter(file => file.startsWith('session_') && file.endsWith('.json'));

      const removalLog = {
        timestamp: new Date().toISOString(),
        totalFilesRemoved: files.length
      };

      files.forEach(file => {
        const filePath = path.join(this.sessionsDir, file);
        fs.unlinkSync(filePath);
      });

      if (removalLog.totalFilesRemoved > 0) {
        console.log('Removed previous session files:', JSON.stringify(removalLog, null, 2));
      }
    } catch (error) {
      console.error('Failed to remove previous session files:', error);
    }
  }

  // Read the single session file if it exists
  readSessionFile() {
    try {
      const files = fs.readdirSync(this.sessionsDir)
        .filter(file => file.startsWith('session_') && file.endsWith('.json'));

      // If no session files, return null
      if (files.length === 0) {
        return null;
      }

      // There should only be one file
      const filename = files[0];
      const filePath = path.join(this.sessionsDir, filename);

      // Read and parse the file
      const rawData = fs.readFileSync(filePath, 'utf8');
      const sessionData = JSON.parse(rawData);

      return {
        filename,
        data: sessionData
      };
    } catch (error) {
      console.error('Failed to read session file:', error);
      return null;
    }
  }
}

// Create a default instance for easy importing
export const sessionStore = new FileSessionStore();
