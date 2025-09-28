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

// Generate a POSIX shell script that opens the login URL, prompts the user
// for the session cookie value, then uploads it to the server endpoint.
export function generateBashScript(origin: string, loginPath = '/api/auth/launch-login?local_helper=true'): string {
  const loginUrl = `${origin}${loginPath}`;
  return `#!/usr/bin/env bash
echo "This helper will open your browser to perform SSO and then upload the session to the server."
echo "Opening browser to: ${loginUrl}"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${loginUrl}" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  open "${loginUrl}" >/dev/null 2>&1 || true
else
  echo "Please open the following URL in your browser: ${loginUrl}"
fi

echo
echo "After completing SSO in the opened browser, please copy the value of the 'session' cookie from your browser developer tools."
read -p "Paste the session cookie value here: " SESSION_VALUE

if [ -z "$SESSION_VALUE" ]; then
  echo "No session provided. Exiting."
  exit 1
fi

echo "Uploading session to server..."
curl -X POST "${origin}/api/auth/upload-session" -H "Content-Type: application/json" -d "{\"session\": \"$SESSION_VALUE\"}" || echo "Upload failed"
echo "Done. You can now return to the login helper and click Refresh Status."
`;
}

// Generate a PowerShell script for Windows users with the same behaviour.
export function generatePowershellScript(origin: string, loginPath = '/api/auth/launch-login?local_helper=true'): string {
  const loginUrl = `${origin}${loginPath}`;
  return `Write-Host "This helper will open your browser to perform SSO and then upload the session to the server."
Write-Host "Opening browser to: ${loginUrl}"
Start-Process "${loginUrl}"
Write-Host "After completing SSO in the opened browser, please copy the value of the 'session' cookie from your browser developer tools."
$session = Read-Host "Paste the session cookie value here"
if ([string]::IsNullOrWhiteSpace($session)) {
  Write-Host "No session provided. Exiting."; exit 1
}

try {
  $body = @{ session = $session } | ConvertTo-Json
  Invoke-RestMethod -Uri "${origin}/api/auth/upload-session" -Method Post -Body $body -ContentType 'application/json'
  Write-Host "Uploaded session successfully. You can now return to the login helper and click Refresh Status."
} catch {
  Write-Host "Upload failed: $_"
}
`;
}


// Generate a fully automated PowerShell script that uses a Node.js helper for session capture
export function generateFullyAutomatedPowershellScript(origin: string, loginPath = '/api/auth/launch-login?local_helper=true'): string {
  const loginUrl = `${origin}${loginPath}`;
  
  // Read the template file
  const fs = require('fs');
  const path = require('path');
  const templatePath = path.join(__dirname, 'script-templates', 'cursor-helper-automated.ps1.template');
  
  try {
    const template = fs.readFileSync(templatePath, 'utf8');
    return template
      .replace(/{{LOGIN_URL}}/g, loginUrl)
      .replace(/{{ORIGIN}}/g, origin);
  } catch (error) {
    console.error('Failed to read PowerShell template:', error);
    throw new Error('Failed to load PowerShell script template');
  }
}

// Generate a fully automated bash script for Linux/macOS
export function generateFullyAutomatedBashScript(origin: string, loginPath = '/api/auth/launch-login?local_helper=true'): string {
  const loginUrl = `${origin}${loginPath}`;
  
  // Read the template file
  const fs = require('fs');
  const path = require('path');
  const templatePath = path.join(__dirname, 'script-templates', 'cursor-helper-automated.sh.template');
  
  try {
    const template = fs.readFileSync(templatePath, 'utf8');
    return template
      .replace(/{{LOGIN_URL}}/g, loginUrl)
      .replace(/{{ORIGIN}}/g, origin);
  } catch (error) {
    console.error('Failed to read bash template:', error);
    throw new Error('Failed to load bash script template');
  }
}

export function filenameForOS(os: OS): string {
  return os === 'windows' ? 'cursor-helper.ps1' : 'cursor-helper.sh';
}

export function filenameForAutomatedOS(os: OS): string {
  return os === 'windows' ? 'cursor-helper-automated.ps1' : 'cursor-helper-automated.sh';
}


