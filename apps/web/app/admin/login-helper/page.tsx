'use client';

import { useState, useEffect } from 'react';

interface AuthStatus {
  isAuthenticated: boolean;
  lastChecked: string;
  error?: string;
}

export default function LoginHelperPage() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

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

  const launchLogin = async () => {
    setIsLaunching(true);
    try {
      const response = await fetch('/api/auth/launch-login', { method: 'POST' });
      const data = await response.json();
      
      if (data.success) {
        // Wait a moment then re-check auth status
        setTimeout(() => {
          checkAuthStatus();
        }, 2000);
      } else {
        alert('Failed to launch login window: ' + data.error);
      }
    } catch (error) {
      alert('Failed to launch login window');
    } finally {
      setIsLaunching(false);
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
            <h1 className="text-2xl font-bold text-gray-900 mb-6">
              Cursor Login Helper
            </h1>
            
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
                  
                  <p className="text-sm text-gray-500">
                    Last checked: {new Date(authStatus.lastChecked).toLocaleString()}
                  </p>
                  
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
                onClick={launchLogin}
                disabled={isLaunching || isLoading}
                className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLaunching ? 'Launching...' : 'Launch Cursor Login'}
              </button>
            </div>

            {/* Instructions */}
            <div className="mt-6 text-left">
              <h3 className="text-sm font-medium text-gray-900 mb-2">Instructions:</h3>
              <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
                <li>Click &quot;Launch Cursor Login&quot; to open a browser window</li>
                <li>Complete the login process in the opened window</li>
                <li>Click &quot;Refresh Status&quot; to verify authentication</li>
                <li>The scraper will automatically use your saved session</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
