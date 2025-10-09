import fs from 'fs';
import path from 'path';
import crypto, { 
  CipherGCMTypes, 
  CipherKey, 
  BinaryLike, 
  KeyObject 
} from 'crypto';

/**
 * FileSessionStore
 *
 * Responsibility:
 * - Manage a single uploaded session artifact on disk (optionally encrypted)
 * - Provide read/decrypt functionality to higher-level orchestrators
 *
 * Non-responsibilities:
 * - Does not decide auth truth; does not integrate directly with Playwright
 * - Does not own canonical minimal auth state (see CursorAuthManager)
 */

// Node's crypto accepts Buffers directly; no conversion necessary

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

  // Encrypt data using AES-256-GCM
  private encrypt(data: any): { payload: any, isEncrypted: true } {
    const ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY;
    if (!ENCRYPTION_KEY) {
      throw new Error('SESSION_ENCRYPTION_KEY not set');
    }

    const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error('SESSION_ENCRYPTION_KEY must be 32 bytes (hex-encoded)');
    }

    const dataToEncrypt = JSON.stringify(data);
    const cryptoAny = crypto as any;
    const iv = cryptoAny.randomBytes(12);
    const cipher = cryptoAny.createCipheriv(
      'aes-256-gcm', 
      cryptoAny.createSecretKey(keyBuffer), 
      iv
    );
    const encrypted = Buffer.concat([
      cipher.update(dataToEncrypt, 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return {
      payload: {
        ciphertext: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        tag: authTag.toString('base64'),
        createdAt: new Date().toISOString(),
        isEncrypted: true
      },
      isEncrypted: true
    };
  }

  // Decrypt data using AES-256-GCM
  private decrypt(encryptedData: any): any {
    const ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY;
    if (!ENCRYPTION_KEY) {
      throw new Error('SESSION_ENCRYPTION_KEY not set');
    }

    const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error('SESSION_ENCRYPTION_KEY must be 32 bytes (hex-encoded)');
    }

    const cryptoAny = crypto as any;
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const encrypted = Buffer.from(encryptedData.ciphertext, 'base64');
    const authTag = Buffer.from(encryptedData.tag, 'base64');
    
    const decipher = cryptoAny.createDecipheriv(
      'aes-256-gcm', 
      cryptoAny.createSecretKey(keyBuffer), 
      iv
    );
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    return JSON.parse(decrypted.toString('utf8'));
  }

  // Save session with optional encryption
  save(payload: any, encrypt: boolean = true) {
    try {
      // Remove all existing session files before saving new one
      this.removeAllSessions();

      // Generate unique filename
      const filename = `session_${crypto.randomBytes(16).toString('hex')}.json`;
      const filePath = path.join(this.sessionsDir, filename);

      // Encrypt if requested
      const finalPayload = encrypt ? this.encrypt(payload).payload : {
        ...payload,
        isEncrypted: false,
        createdAt: new Date().toISOString()
      };

      // Prepare logging details
      const fileSize = Buffer.byteLength(JSON.stringify(finalPayload), 'utf8');
      const logDetails = {
        filename,
        timestamp: new Date().toISOString(),
        payloadSize: fileSize,
        encrypted: !!encrypt
      };

      // Write with secure permissions
      fs.writeFileSync(filePath, JSON.stringify(finalPayload), {
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

      // Decrypt if encrypted
      const finalData = sessionData.isEncrypted 
        ? this.decrypt(sessionData) 
        : sessionData;

      return {
        filename,
        data: finalData
      };
    } catch (error) {
      console.error('Failed to read session file:', error);
      return null;
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
}

// Create a default instance for easy importing
export const sessionStore = new FileSessionStore();
