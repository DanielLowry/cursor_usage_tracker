"use client";

import { useState, useEffect } from 'react';
import { detectOS, generateFullyAutomatedPowershellScript, generateFullyAutomatedBashScript, filenameForOS, filenameForAutomatedOS } from '../../../lib/login-helper-scripts';

interface AuthStatus {
  isAuthenticated: boolean;
  lastChecked: string;
  error?: string;
}

/*
  LoginHelperPage (client)

  Purpose:
  - Show whether the server has access to the Cursor dashboard/session
  - Allow operators to launch a headful login flow on the server (when possible)
  - Provide a small downloadable helper script (per-OS) the *local* user can
    run to complete SSO in a browser on their machine and securely upload
    the resulting session/token back to the server.

  Security notes:
  - The helper script asks the user to paste their 'session' cookie value
    from the browser developer tools and sends it to `POST /api/auth/upload-session`.
  - The server endpoint must validate and securely persist the uploaded
    session; this page only produces client-side helper scripts and does
    not change server-side authentication behaviour.

  The helper script approach is intentionally simple: it avoids shipping
  a headful browser inside the server environment and lets a real user
  perform SSO locally where browser-based OAuth/SSO flows work normally.
*/

export default function LoginHelperPage() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isDownloadingAutomated, setIsDownloadingAutomated] = useState(false);

  const checkAuthStatus = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/status');
      const data = await response.json();
      setAuthStatus(data);
    } catch (error) {
      setAuthStatus({
        isAuthenticated: false,
        lastChecked: new Date().toISOString(),
        error: 'Failed to check auth status'
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Launch login removed: server-side headful login is no longer supported.

  // downloadAutomatedHelperScript
  // - Create an automated helper script that waits for authentication and
  //   attempts to capture session data automatically.
  const downloadAutomatedHelperScript = async () => {
    setIsDownloadingAutomated(true);
    try {
      const origin = window.location.origin;
      const os = detectOS();

      // The automated helper scripts were removed in favor of the browser extension.
      // Inform the user and provide instructions to use the extension instead.
      alert('Automated helper scripts have been removed. Please use the browser extension via "Download Browser Extension".');
    } catch (err) {
      console.error(err);
      alert('Failed to prepare automated helper script');
    } finally {
      setIsDownloadingAutomated(false);
    }
  };

  useEffect(() => {
    checkAuthStatus();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto">
        <div className="bg-white shadow rounded-lg p-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">Cursor Login Helper</h1>

            {/* Auth Status Display */}
            <div className="mb-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Authentication Status</h2>

              {isLoading ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <span className="ml-2 text-gray-600">Checking...</span>
                </div>
              ) : authStatus ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-center">
                    {authStatus.isAuthenticated ? (
                      <div className="flex items-center text-green-600">
                        <svg className="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">Authenticated</span>
                      </div>
                    ) : (
                      <div className="flex items-center text-red-600">
                        <svg className="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">Not Authenticated</span>
                      </div>
                    )}
                  </div>

                  <p className="text-sm text-gray-500">Last checked: {new Date(authStatus.lastChecked).toLocaleString()}</p>

                  {authStatus.error && (
                    <p className="text-sm text-red-600">{authStatus.error}</p>
                  )}
                </div>
              ) : null}
            </div>

            {/* Actions */}
            <div className="space-y-4">
              <button
                onClick={checkAuthStatus}
                disabled={isLoading}
                className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Checking...' : 'Refresh Status'}
              </button>

              <button
                onClick={() => (window.location.href = '/api/extension/download')}
                className="w-full bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700"
              >
                Download Browser Extension
              </button>

              {/* Launch cursor login removed */}
            </div>

            {/* Instructions */}
            <div className="mt-6 text-left">
              <h3 className="text-sm font-medium text-gray-900 mb-2">Instructions:</h3>
              <div className="text-sm text-gray-600 space-y-2">
                {/* Server-side login instructions removed */}
                <div>
                  <h4 className="font-medium text-gray-800">Option 2: Browser Extension</h4>
                  <ol className="ml-4 space-y-1 list-decimal list-inside">
                    <li>Click "Download Browser Extension" to get the extension</li>
                    <li>Open Chrome and go to chrome://extensions/</li>
                    <li>Enable "Developer mode" in the top right</li>
                    <li>Drag and drop the downloaded .zip file into Chrome</li>
                    <li>Click the extension icon and "Capture Session Data"</li>
                    <li>Return here and click "Refresh Status" to verify</li>
                  </ol>

                  <div className="mt-4">
                    <h5 className="font-medium text-gray-800">Extension configuration (one-time)</h5>
                    <p className="text-sm text-gray-600 mt-2">Before using the extension for the first time, open its popup and ensure it is configured to upload captured session data to this server:</p>
                    <ol className="ml-4 space-y-1 list-decimal list-inside text-sm text-gray-600">
                      <li>Open the extension popup (click the extension icon) and look for a configuration or settings input.</li>
                      <li>Set the <code>Upload URL</code> to your server's upload endpoint: <code>https://your-server.example.com/api/auth/upload-session</code> (replace with your server URL).</li>
                      <li>Save the setting. The extension stores this value in <code>chrome.storage.local</code> under the key <code>uploadUrl</code>.</li>
                      <li>Verify the extension shows a connected/ready state in the popup. If it reports "Extension not configured", re-open the popup and re-enter the URL.</li>
                      <li>Ensure the extension requests the permission to access <code>https://*.cursor.sh/*</code> domains (check the extension manifest via Developer mode). This is required to read cookies and storage from the Cursor site.</li>
                      <li>When configured, navigate to a <code>cursor.sh</code> page where you are logged in, open the extension popup and click "Capture Session Data". A success message should appear when the upload completes.</li>
                    </ol>

                    <p className="text-xs text-gray-500 mt-2">If you manage multiple deployment environments, make sure the upload URL matches the environment (e.g., staging vs production).</p>
                  </div>

                  <div className="mt-4">
                    <h5 className="font-medium text-gray-800">Troubleshooting</h5>
                    <ul className="ml-4 space-y-1 list-disc list-inside text-sm text-gray-600">
                      <li>If the popup shows "Extension not configured", re-enter the upload URL and save.</li>
                      <li>If captures fail with "No Cursor session found", confirm you are signed into Cursor in the browser and on a <code>cursor.sh</code> tab.</li>
                      <li>Check your server logs for requests to <code>/api/auth/upload-session</code> to confirm uploads are received.</li>
                    </ul>
                  </div>

                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
