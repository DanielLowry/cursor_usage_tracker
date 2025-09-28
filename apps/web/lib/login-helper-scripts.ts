// Helper utilities for creating small OS-specific helper scripts that
// guide a user through performing SSO locally and uploading the resulting
// session back to the server. These functions are intentionally small and
// string-based so they can be generated client-side and offered for download.

export type OS = 'windows' | 'macos' | 'linux';

// Detect the user's OS based on navigator data. This runs in the browser
// (the calling component should be a client component). We keep detection
// logic isolated here so it's easy to test and reuse.
export function detectOS(): OS {
  const platform = typeof navigator !== 'undefined' ? (navigator.userAgent || navigator.platform || '') : '';
  if (/Win(dows )?/i.test(platform)) return 'windows';
  if (/Mac|Macintosh|Darwin/i.test(platform)) return 'macos';
  if (/Linux/i.test(platform)) return 'linux';
  return 'linux';
}

// Generate a fully automated PowerShell script that uses a Node.js helper for session capture
export function generateFullyAutomatedPowershellScript(origin: string, loginPath = '/api/auth/launch-login?local_helper=true'): string {
  const loginUrl = `${origin}${loginPath}`;

  // Server-side: read the template file from disk. Use eval('require') to avoid bundlers
  // trying to resolve `fs` for client-side builds.
  if (typeof window === 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fs = eval('require')('fs');
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const path = eval('require')('path');
      const templatePath = path.join(__dirname, 'script-templates', 'cursor-helper-automated.ps1.template');
      const template = fs.readFileSync(templatePath, 'utf8');
      return template
        .replace(/{{LOGIN_URL}}/g, loginUrl)
        .replace(/{{ORIGIN}}/g, origin);
    } catch (error) {
      console.error('Failed to read PowerShell template on server:', error);
      // Fall through to client-safe fallback
    }
  }

  // Client-side fallback (safe for bundlers): small placeholder that includes the login URL
  return `# Fully Automated Cursor Login Helper\n# Login URL: ${loginUrl}\n# To use full automation, download and run the server-provided script on your machine.\n`;
}

// Generate a fully automated bash script for Linux/macOS
export function generateFullyAutomatedBashScript(origin: string, loginPath = '/api/auth/launch-login?local_helper=true'): string {
  const loginUrl = `${origin}${loginPath}`;

  if (typeof window === 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fs = eval('require')('fs');
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const path = eval('require')('path');
      const templatePath = path.join(__dirname, 'script-templates', 'cursor-helper-automated.sh.template');
      const template = fs.readFileSync(templatePath, 'utf8');
      return template
        .replace(/{{LOGIN_URL}}/g, loginUrl)
        .replace(/{{ORIGIN}}/g, origin);
    } catch (error) {
      console.error('Failed to read bash template on server:', error);
      // Fall through to client-safe fallback
    }
  }

  // Client-side fallback
  return `#!/usr/bin/env bash\n# Fully Automated Cursor Login Helper\n# Open browser to: ${loginUrl}\n# To use full automation, download and run the server-provided script on your machine.\n`;
}

export function filenameForOS(os: OS): string {
  return os === 'windows' ? 'cursor-helper.ps1' : 'cursor-helper.sh';
}

export function filenameForAutomatedOS(os: OS): string {
  return os === 'windows' ? 'cursor-helper-automated.ps1' : 'cursor-helper-automated.sh';
}


