// Background service worker that handles cookie capture, verifies auth against
// Cursor's /api/auth/me endpoint, and uploads captured session data when valid.
//
// Provides two message actions:
// - "captureCursorSession": existing capture-and-upload flow (unchanged behavior)
// - "CAPTURE_AND_VERIFY_CURSOR": captures cookies/storage and returns auth probe
//    result along with captured data so the popup can decide whether to upload.
//
// NOTE: We intentionally probe `https://cursor.com/api/auth/me` from the
// background service worker using `fetch` with `credentials: 'include'` so the
// probe uses captured cookies in the browser context.
//
// Keep file header documentation short and focused to help future maintainers.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureCursorSession') {
    captureCursorSession()
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep the message channel open for async response
  }

  if (request.action === 'CAPTURE_AND_VERIFY_CURSOR') {
    captureAndVerifyCursor()
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});

// Default upload URL 
const DEFAULT_UPLOAD_URL = 'http://192.168.0.1:3000/api/auth/upload-session';

/**
 * Capture the user's Cursor session and upload it to the configured server.
 *
 * Gate A is enforced first by probing the real `https://cursor.com` tab using
 * a first‑party, credentialed fetch to `/api/usage-summary`. If the probe
 * fails (401/403, HTML/login, 3xx/network error, or empty/unauthorized JSON),
 * the function throws and nothing is uploaded. On success, it gathers cookies
 * and storage and POSTs them to the `uploadUrl`.
 *
 * Returns `{ success: true }` on successful upload; throws `Error` with a
 * clear message on failure.
 */
async function captureCursorSession() {
  try {
    console.log('Starting session capture...');
		// Gate A: ensure the session in the browser is actually authenticated by
		// probing /api/usage-summary inside a cursor.com page (first-party cookies).
		const preProbe = await probeCursorAuthInTab();
		if (!preProbe || !preProbe.ok) {
			const reason = preProbe ? preProbe.reason : 'unknown';
			throw new Error('Not authenticated — please open https://cursor.com/dashboard and log in. (' + reason + ')');
		}
    // Capture cookies, tabs and storage (shared helper)
    const { cookies, tabs, storage } = await captureSessionData();

    console.log('Cookies found:', cookies.length);
    console.log('Cookie details:', cookies.map(cookie => ({ name: cookie.name, domain: cookie.domain, path: cookie.path })));

    // Detailed upload URL logging
    const { uploadUrl, useCustomUploadUrl } = await chrome.storage.local.get(['uploadUrl', 'useCustomUploadUrl']);
    const finalUploadUrl = uploadUrl || DEFAULT_UPLOAD_URL;
    console.log('Final Upload URL:', finalUploadUrl);
    console.log('Using custom upload URL:', useCustomUploadUrl);

    if (!finalUploadUrl) {
      throw new Error('Extension not configured');
    }

    // Basic validation
    if (!cookies.length) {
      throw new Error('No Cursor session found. Please ensure you are logged in to Cursor.');
    }

    // Prepare the session data
    const sessionData = { cookies, localStorage: storage.localStorage, sessionStorage: storage.sessionStorage, timestamp: new Date().toISOString() };

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

// Helper: capture cookies, tabs and storage (local/session) for cursor.com
async function captureSessionData() {
  const domains = ['cursor.com', '.cursor.com'];
  const cookies = (await Promise.all(domains.map(d => chrome.cookies.getAll({ domain: d })))).flat();

  const tabs = await chrome.tabs.query({ url: ['https://cursor.com/*', 'https://*.cursor.com/*'] });
  let storage = { localStorage: {}, sessionStorage: {} };

  if (tabs.length > 0) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          const data = { localStorage: {}, sessionStorage: {} };
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            data.localStorage[key] = window.localStorage.getItem(key);
          }
          for (let i = 0; i < window.sessionStorage.length; i++) {
            const key = window.sessionStorage.key(i);
            data.sessionStorage[key] = window.sessionStorage.getItem(key);
          }
          return data;
        }
      });

      if (results && results[0]) storage = results[0].result;
    } catch (err) {
      console.warn('Failed to extract storage via scripting.executeScript:', err.message);
    }
  }

  return { cookies, tabs, storage };
}

async function getOrOpenCursorTab() {
  // Prefer an apex dashboard tab; then any apex page; otherwise open one
  let [tab] = await chrome.tabs.query({ url: ['https://cursor.com/dashboard*'] });
  if (!tab) [tab] = await chrome.tabs.query({ url: ['https://cursor.com/*'] });
  if (!tab) {
    tab = await chrome.tabs.create({ url: 'https://cursor.com/dashboard' });
    await new Promise(r => setTimeout(r, 1500));
  }
  return tab;
}

/**
 * Gate A: Probe authentication status from an actual `https://cursor.com` tab.
 *
 * Performs a single-probe (with one quick retry ~800ms later) against
 * `/api/usage-summary` using `credentials: 'include'` to ensure first‑party
 * cookies are used. Treats 3xx, network errors, HTML responses, 401/403, and
 * obviously unauthenticated or empty JSON as failures.
 *
 * Logs origin, href, status, and top-level JSON keys for observability.
 *
 * Returns a structured object like:
 * `{ ok: boolean, origin: string, href: string, status: number, keys?: string[], reason?: string }`
 */
async function probeCursorAuthInTab() {
	const tab = await getOrOpenCursorTab();

	// Ensure we’re really on the apex origin before probing
	if (!/^https:\/\/cursor\.com\//.test(tab.url || '')) {
		await chrome.tabs.update(tab.id, { url: 'https://cursor.com/dashboard' });
		await new Promise(r => setTimeout(r, 1500));
	}

	const [exec] = await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		world: 'MAIN', // run in page, not isolated world
		func: async () => {
			const origin = location.origin, href = location.href;

			const pack = (ok, extra = {}) => ({ ok, origin, href, ...extra });

			const attempt = async () => {
				try {
					const r = await fetch('/api/usage-summary', { credentials: 'include' });
					const contentType = r.headers.get('content-type') || '';
					let json = null;
					let textSample = '';
					try {
						json = await r.json();
					} catch {
						try { textSample = (await r.text()).slice(0, 200); } catch {}
					}
					return { status: r.status, contentType, json, textSample };
				} catch (e) {
					return { status: 0, contentType: '', json: null, textSample: '', error: String(e) };
				}
			};

			const evaluate = (resp) => {
				const isHtml = /text\/html/i.test(resp.contentType) || (resp.textSample && /<html|<body|<!doctype/i.test(resp.textSample));
				if (isHtml) return { ok: false, reason: 'html_response' };
				if (resp.status >= 300 && resp.status < 400) return { ok: false, reason: `status:${resp.status}` };
				if (resp.status === 401 || resp.status === 403) return { ok: false, reason: `status:${resp.status}` };
				if (resp.status !== 200) return { ok: false, reason: `status:${resp.status}` };
				const j = resp.json;
				const isObject = j && typeof j === 'object' && !Array.isArray(j);
				if (!isObject) return { ok: false, reason: 'invalid_json' };
				const keys = Object.keys(j || {});
				const required = ['billingCycleStart', 'billingCycleEnd', 'membershipType'];
				const hasRequiredFields = required.every(k => k in (j || {}));
				if (!hasRequiredFields) return { ok: false, reason: 'missing_fields', keys };
				return { ok: true, keys };
			};

			const a1 = await attempt();
			let ev1 = evaluate(a1);
			if (ev1.ok) {
				console.log('[usage-summary probe] origin:', origin, 'href:', href, 'status:', a1.status, 'keys:', ev1.keys?.join(', ') || 'none');
				return pack(true, { status: a1.status, keys: ev1.keys });
			}

			await new Promise(r => setTimeout(r, 800));
			const a2 = await attempt();
			let ev2 = evaluate(a2);
			console.log('[usage-summary probe] origin:', origin, 'href:', href, 'status:', a2.status, 'keys:', (ev2.keys || []).join(', '));
			if (ev2.ok) return pack(true, { status: a2.status, keys: ev2.keys });

			const reason = a2.error ? `fetch_error:${a2.error}` : (ev2.reason || 'unknown');
			return pack(false, { status: a2.status, reason, keys: ev2.keys || [], sample: a2.textSample || null });
		}
	});

	const result = exec?.result ?? { ok: false, reason: 'no_result', origin: null, href: null, status: 0 };
	console.log('[probeCursorAuthInTab] result:', result);
	return result;
}


// Capture cookies and storage and return them together with an auth probe.
/**
 * Capture cookies and storage and return them along with the Gate A probe
 * result, without uploading. Used by the popup to present auth status and
 * decide whether to proceed with upload.
 *
 * Returns `{ cookies, localStorage, sessionStorage, authProbe, timestamp }`.
 */
async function captureAndVerifyCursor() {
  // Reuse capture logic but do not upload here — just return results
  console.log('Starting captureAndVerifyCursor...');

  const domains = [
    'cursor.com', '.cursor.com'
  ];

  const cookies = (await Promise.all(
    domains.map(d => chrome.cookies.getAll({ domain: d }))
  )).flat();

  console.log('Captured cookies (summary):', cookies.map(c => ({ name: c.name, domain: c.domain, httpOnly: c.httpOnly, secure: c.secure })));

  // Attempt to get a cursor.com tab to extract localStorage/sessionStorage
  const tabs = await chrome.tabs.query({ url: ['https://cursor.com/*', 'https://*.cursor.com/*'] });
  let storage = { localStorage: {}, sessionStorage: {} };

  if (tabs.length > 0) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          const data = { localStorage: {}, sessionStorage: {} };
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            data.localStorage[key] = window.localStorage.getItem(key);
          }
          for (let i = 0; i < window.sessionStorage.length; i++) {
            const key = window.sessionStorage.key(i);
            data.sessionStorage[key] = window.sessionStorage.getItem(key);
          }
          return data;
        }
      });

      if (results && results[0]) storage = results[0].result;
    } catch (err) {
      console.warn('Failed to extract storage via scripting.executeScript:', err.message);
    }
  }

	const probe = await probeCursorAuthInTab();

  return {
    cookies,
    localStorage: storage.localStorage,
    sessionStorage: storage.sessionStorage,
    authProbe: probe,
    timestamp: new Date().toISOString()
  };
}

// On first install, set a default upload URL
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ 
    uploadUrl: DEFAULT_UPLOAD_URL,
    useCustomUploadUrl: false 
  });
});
