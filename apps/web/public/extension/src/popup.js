// Popup script that handles the UI and communicates with the background service worker
document.addEventListener('DOMContentLoaded', () => {
  const statusDiv = document.getElementById('status');
  const captureBtn = document.getElementById('captureBtn');
  const uploadUrlInput = document.getElementById('uploadUrl');
  const saveUrlBtn = document.getElementById('saveUrlBtn');
  const configStatusDiv = document.getElementById('configStatus');

  // Default upload URL (can be overridden)
  const DEFAULT_UPLOAD_URL = 'https://cursor.sh/api/auth/upload-session';

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

      // Request the background script to capture cookies
      const response = await chrome.runtime.sendMessage({ action: 'captureCursorSession' });
      
      if (response.error) {
        throw new Error(response.error);
      }

      showSuccess('Session data captured and uploaded successfully!');
    } catch (error) {
      showError(`Failed to capture session: ${error.message}`);
      captureBtn.disabled = false;
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
