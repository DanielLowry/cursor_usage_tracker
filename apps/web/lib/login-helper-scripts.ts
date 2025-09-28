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

  // Client-side: request the server to provide the full template content.
  // This function returns a minimal placeholder when called synchronously.
  // The client should fetch `/api/scripts/template?name=cursor-helper-automated.ps1.template`
  // to get the complete script text for download.

  return `# Fully Automated Cursor Login Helper\n# Login URL: ${loginUrl}\n# To get the full automated helper script, fetch:\n# ${origin}/api/scripts/template?name=cursor-helper-automated.ps1.template\n`;
}

// Generate a fully automated bash script for Linux/macOS
export function generateFullyAutomatedBashScript(origin: string, loginPath = '/api/auth/launch-login?local_helper=true'): string {
  const loginUrl = `${origin}${loginPath}`;

  // Client-side: return a minimal placeholder and instruct clients to fetch the
  // full script from the server endpoint.
  return `#!/usr/bin/env bash\n# Fully Automated Cursor Login Helper\n# Open browser to: ${loginUrl}\n# To fetch the full automated helper script, request:\n# ${origin}/api/scripts/template?name=cursor-helper-automated.sh.template\n`;
}

export function filenameForOS(os: OS): string {
  return os === 'windows' ? 'cursor-helper.ps1' : 'cursor-helper.sh';
}

export function filenameForAutomatedOS(os: OS): string {
  return os === 'windows' ? 'cursor-helper-automated.ps1' : 'cursor-helper-automated.sh';
}


