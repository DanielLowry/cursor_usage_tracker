// Popup script that handles the UI and communicates with the background service worker
document.addEventListener('DOMContentLoaded', () => {
  const statusDiv = document.getElementById('status');
  const captureBtn = document.getElementById('captureBtn');
  
  // Get the upload URL from storage (set during extension installation)
  chrome.storage.local.get(['uploadUrl'], async (result) => {
    if (!result.uploadUrl) {
      showError('Extension not configured. Please reinstall.');
      captureBtn.disabled = true;
      return;
    }
  });

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
});

function showStatus(message, type) {
  const statusDiv = document.getElementById('status');
  statusDiv.className = `status ${type}`;
  statusDiv.textContent = message;
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
