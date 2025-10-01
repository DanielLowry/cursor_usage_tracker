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
// The automated helper script generators were removed in favor of the browser
// extension. Keep small helper utilities used elsewhere.
export function generateFullyAutomatedPowershellScript(origin: string, loginPath = '/api/auth/launch-login?local_helper=true'): string {
  const loginUrl = `${origin}${loginPath}`;
  return `# Automated helper scripts removed; use the browser extension.\n# For manual steps, open: ${loginUrl}\n`;
}

export function generateFullyAutomatedBashScript(origin: string, loginPath = '/api/auth/launch-login?local_helper=true'): string {
  const loginUrl = `${origin}${loginPath}`;
  return `# Automated helper scripts removed; use the browser extension.\n# For manual steps, open: ${loginUrl}\n`;
}

export function filenameForOS(os: OS): string {
  return os === 'windows' ? 'cursor-helper.ps1' : 'cursor-helper.sh';
}

export function filenameForAutomatedOS(os: OS): string {
  return os === 'windows' ? 'cursor-helper-automated.ps1' : 'cursor-helper-automated.sh';
}


