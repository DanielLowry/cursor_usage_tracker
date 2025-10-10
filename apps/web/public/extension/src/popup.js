// Popup script: handles UI interactions for the extension popup. It requests the
// background service worker to capture cookies/storage and to probe Cursor's
// authentication endpoint before attempting to upload. This prevents saving
// expired/invalid sessions.
document.addEventListener('DOMContentLoaded', () => {
  const statusDiv = document.getElementById('status');
  const captureBtn = document.getElementById('captureBtn');
  const checkAuthBtn = document.getElementById('checkAuthBtn');
  const uploadUrlInput = document.getElementById('uploadUrl');
  const saveUrlBtn = document.getElementById('saveUrlBtn');
  const configStatusDiv = document.getElementById('configStatus');

  // Default upload URL (can be overridden)
  const DEFAULT_UPLOAD_URL = 'http://192.168.0.1:3000/api/auth/upload-session';

  // Load and display current upload URL
  chrome.storage.local.get(['uploadUrl', 'useCustomUploadUrl'], (result) => {
    const uploadUrl = result.uploadUrl || DEFAULT_UPLOAD_URL;
    const useCustomUploadUrl = result.useCustomUploadUrl || false;

    uploadUrlInput.value = uploadUrl;
    
    // Check if extension is configured
    if (!uploadUrl) {
      showError('Extension not configured. Please set an upload URL.');
      captureBtn.disabled = true;
    }
  });

  // Save upload URL
  saveUrlBtn.addEventListener('click', () => {
    const url = uploadUrlInput.value.trim();
    
    // Basic URL validation
    try {
      new URL(url);
    } catch (error) {
      showConfigError('Invalid URL. Please enter a valid HTTPS URL.');
      return;
    }

    // Save the URL and mark it as a custom URL
    chrome.storage.local.set({ 
      uploadUrl: url,
      useCustomUploadUrl: true 
    }, () => {
      showConfigSuccess('Upload URL saved successfully!');
    });
  });
  
  // Capture button logic
  captureBtn.addEventListener('click', async () => {
    try {
      captureBtn.disabled = true;
      showInfo('Capturing session data...');

      // Before capturing, ensure auth has been checked and is valid
      const verifyResponse = await chrome.runtime.sendMessage({ action: 'CAPTURE_AND_VERIFY_CURSOR' });
      if (verifyResponse.error) throw new Error(verifyResponse.error);

      // If not authenticated, prompt user to login and abort
      if (!verifyResponse.authProbe || !verifyResponse.authProbe.authenticated) {
        const reason = verifyResponse.authProbe ? verifyResponse.authProbe.reason : 'unknown';
        showError('Not authenticated — please open https://cursor.com/dashboard and log in. (' + reason + ')');
        captureBtn.disabled = false;
        return;
      }

      // Authenticated — proceed to upload via existing capture flow
      const response = await chrome.runtime.sendMessage({ action: 'captureCursorSession' });
      if (response.error) {
        throw new Error(response.error);
      }

      const user = verifyResponse.authProbe.user;
      const display = user?.email || user?.name || 'unknown user';
      showSuccess('Authenticated as ' + display + '. Session captured and uploaded successfully!');
    } catch (error) {
      showError(`Failed to capture session: ${error.message}`);
      captureBtn.disabled = false;
    }
  });

  // Check auth button logic — show the auth probe result to the user
  checkAuthBtn.addEventListener('click', async () => {
    try {
      checkAuthBtn.disabled = true;
      showInfo('Checking Cursor authentication...');
      const res = await chrome.runtime.sendMessage({ type: 'CAPTURE_AND_VERIFY_CURSOR' });
      const probe = res?.probe;
      console.log('[popup] probe:', probe);

      if (!probe?.ok) {
        const details = [
          probe?.reason,
          probe?.status ? `status:${probe.status}` : null,
          probe?.origin ? `origin:${probe.origin}` : null,
          probe?.href ? `href:${probe.href}` : null,
        ].filter(Boolean).join(' | ');
        show(`Not authenticated — please open https://cursor.com/dashboard and log in. (${details || 'no_details'})`);
      } else {
        const who = probe.user?.email || probe.user?.name || 'user';
        show(`Authenticated as ${who}`);
      }
      
      if (verifyResponse.error) throw new Error(verifyResponse.error);

      if (verifyResponse.authProbe && verifyResponse.authProbe.authenticated) {
        const user = verifyResponse.authProbe.user;
        const display = user?.email || user?.name || 'unknown user';
        showSuccess('Authenticated as ' + display);
      } else {
        const reason = verifyResponse.authProbe ? verifyResponse.authProbe.reason : 'unknown';
        showError('Not authenticated — please open https://cursor.com/dashboard and log in. (' + reason + ')');
      }
    } catch (err) {
      showError('Auth probe failed: ' + (err.message || String(err)));
    } finally {
      checkAuthBtn.disabled = false;
    }
  });

  // Status display functions
  function showStatus(message, type, targetDiv = statusDiv) {
    targetDiv.className = `status ${type}`;
    targetDiv.textContent = message;
  }

  function showError(message) {
    showStatus(message, 'error');
  }

  function showSuccess(message) {
    showStatus(message, 'success');
  }

  function showInfo(message) {
    showStatus(message, 'info');
  }

  function showConfigError(message) {
    showStatus(message, 'error', configStatusDiv);
  }

  function showConfigSuccess(message) {
    showStatus(message, 'success', configStatusDiv);
  }
});
