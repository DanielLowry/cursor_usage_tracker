// Relative path: apps/web/app/api/auth/status/helpers.ts

import { CursorAuthManager, readRawCookies, getAuthHeaders } from '../../../../../../packages/shared/cursor-auth/src';

// Heuristic helper to detect whether a session file likely contains auth info
/**
 * detectAuthFromSession
 *
 * Purpose:
 * - Inspect arbitrary uploaded SessionData for likely auth-related keys and tokens.
 *
 * Inputs:
 * - sessionData: any (uploaded artifact; may include cookies, localStorage, sessionStorage).
 *
 * Outputs:
 * - { hasAuthData: boolean, hasTokens: boolean, matched: string[] }
 */
export function detectAuthFromSession(sessionData: any) {
	const matched: string[] = [];
	let hasAuthData = false;
	let hasTokens = false;

	console.log('detectAuthFromSession: entry, keys:', sessionData && typeof sessionData === 'object' ? Object.keys(sessionData) : typeof sessionData);

	if (!sessionData || typeof sessionData !== 'object') {
		console.log('detectAuthFromSession: no session object present');
		return { hasAuthData, hasTokens, matched };
	}

	// Inspect cookies (array or object)
	const cookies = (sessionData as any).cookies || (sessionData as any).Cookies || [];
	if (Array.isArray(cookies)) {
		for (const c of cookies) {
			if (!c) continue;
			const name = (c.name || c.key || '').toString();
			const value = (c.value || c.val || c.cookie || '').toString();
			if (/(sess|session|jwt|token|access|id)/i.test(name) || /^eyJ/.test(value)) {
				hasAuthData = true;
				if (/token|jwt|eyJ/.test(name + ' ' + value)) hasTokens = true;
				matched.push(`cookie:${name || '<unnamed>'}`);
				console.log('detectAuthFromSession: cookie matched', { name, valueSnippet: value.slice(0, 40) });
				break;
			}
		}
	}

	// Inspect localStorage / sessionStorage (could be object or array of pairs)
	const storageCandidates = ['localStorage', 'sessionStorage'];
	for (const key of storageCandidates) {
		const storage = (sessionData as any)[key];
		if (!storage) continue;

		// Handle array of { key, value }
		if (Array.isArray(storage)) {
			for (const entry of storage) {
				const k = (entry && (entry.key || entry.name || entry.k) || '').toString();
				const v = (entry && (entry.value || entry.val || entry.v) || '').toString();
				if (/(token|access|refresh|auth|user|cursor)/i.test(k) || /^eyJ/.test(v)) {
					hasAuthData = true;
					if (/token|jwt|eyJ/.test(k + ' ' + v)) hasTokens = true;
					matched.push(`${key}:${k || '<unnamed>'}`);
					console.log('detectAuthFromSession: storage matched', { storage: key, key: k, valueSnippet: v.slice(0, 40) });
				}
			}
		} else if (typeof storage === 'object') {
			for (const k of Object.keys(storage)) {
				const v = String((storage as any)[k] ?? '');
				if (/(token|access|refresh|auth|user|cursor)/i.test(k) || /^eyJ/.test(v)) {
					hasAuthData = true;
					if (/token|jwt|eyJ/.test(k + ' ' + v)) hasTokens = true;
					matched.push(`${key}:${k}`);
					console.log('detectAuthFromSession: storage object matched', { storage: key, key: k, valueSnippet: v.slice(0, 40) });
				}
			}
		}
	}

	// Timestamp presence isn't auth by itself but is useful metadata
	if ((sessionData as any).timestamp || (sessionData as any).createdAt) {
		matched.push('hasTimestamp');
	}

	console.log('detectAuthFromSession: result', { hasAuthData, hasTokens, matched });
	return { hasAuthData, hasTokens, matched };
}

// Extract cookie objects from an uploaded session artifact
/**
 * extractCookiesFromSession
 *
 * Purpose:
 * - Normalize a variety of cookie formats in uploaded SessionData into a minimal set of cookie fields.
 *
 * Inputs:
 * - session: any (uploaded artifact; expects `cookies`/`Cookies`/`cookieStore` arrays when present).
 *
 * Outputs:
 * - Array<{ name, value, domain?, path?, expires?, httpOnly?, secure?, sameSite? }>
 */
export function extractCookiesFromSession(session: any): Array<{
	name: string;
	value: string;
	domain?: string;
	path?: string;
	expires?: number;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: 'Strict' | 'Lax' | 'None';
}> {
	if (!session) return [];
	const raw = (session as any).cookies || (session as any).Cookies || (session as any).cookieStore || (Array.isArray(session) ? session : []);
	if (!Array.isArray(raw)) return [];
	const normalizeSameSite = (val: any): 'Strict' | 'Lax' | 'None' | undefined => {
		if (val == null) return undefined;
		const s = String(val).trim().toLowerCase();
		if (s === 'strict') return 'Strict';
		if (s === 'lax') return 'Lax';
		if (s === 'none') return 'None';
		return undefined;
	};
	return raw
		.filter(Boolean)
		.map((c: any) => {
			let domain = c.domain || c.Domain;
			if (domain && typeof domain === 'string' && domain.startsWith('.')) domain = domain.slice(1);
			const cookie = {
				name: String(c.name || c.key || ''),
				value: String(c.value || c.val || c.cookie || ''),
				domain: domain ? String(domain) : undefined,
				path: String(c.path || '/'),
				expires: typeof c.expires === 'number' ? (c.expires as number) : undefined,
				httpOnly: Boolean(c.httpOnly || c.httponly),
				secure: Boolean(c.secure),
				sameSite: normalizeSameSite(c.sameSite ?? c.same_site ?? c.sameSitePolicy),
			} as {
				name: string;
				value: string;
				domain?: string;
				path?: string;
				expires?: number;
				httpOnly?: boolean;
				secure?: boolean;
				sameSite?: 'Strict' | 'Lax' | 'None';
			};
			return cookie;
		})
		.filter((c) => c.name && c.value);
}

// Build a Cookie header string for a given target URL from cookies
function buildCookieHeaderForUrl(cookies: any[] | undefined, targetUrl: string): string | null {
	if (!cookies || cookies.length === 0) return null;
	const { hostname, pathname, protocol } = new URL(targetUrl);
	const isHttps = protocol === 'https:';
	const now = Math.floor(Date.now() / 1000);
	const matches: string[] = [];
	for (const c of cookies) {
		if (!c || !c.name) continue;
		const name = String(c.name);
		const value = String(c.value ?? '');
		const domain = c.domain ? String(c.domain).replace(/^\./, '') : undefined;
		const path = String(c.path || '/');
		const expires = typeof c.expires === 'number' ? c.expires : undefined;
		const secure = Boolean(c.secure);
		const domainOk = !domain || hostname === domain || hostname.endsWith('.' + domain);
		const pathOk = pathname.startsWith(path);
		const notExpired = !expires || expires === 0 || expires > now;
		const secureOk = !secure || isHttps;
		if (domainOk && pathOk && notExpired && secureOk) {
			matches.push(`${name}=${value}`);
		}
	}
	return matches.length > 0 ? matches.join('; ') : null;
}

async function fetchWithCookies(targetUrl: string, cookieHeader: string | null) {
	const headers: Record<string, string> = { 'Accept': '*/*' };
	if (cookieHeader) headers['Cookie'] = cookieHeader;
	const res = await fetch(targetUrl, { method: 'GET', headers });
	return res;
}

// API verification via HTTP request using cookie header
/**
 * checkUsageSummaryWithCookies
 *
 * Purpose:
 * - Validate cookies by issuing GET to usage-summary, ensuring HTTP 200 and required fields exist.
 *
 * Inputs:
 * - cookies: Array of cookie-like objects (from uploaded session or canonical state).
 *
 * Outputs:
 * - { ok, status, reason, keys, contentType, usageSummary? }
 */
export async function checkUsageSummaryWithCookies(cookies: any[]) {
	try {
		const cookieHeader = buildCookieHeaderForUrl(cookies, 'https://cursor.com/api/usage-summary');
		const r = await fetchWithCookies('https://cursor.com/api/usage-summary', cookieHeader);
		const status = r.status;
		const contentType = (r.headers.get('content-type') || '').toLowerCase();
		let json: any = null;
		let textSample = '';
		try {
			json = await r.json();
		} catch {
			try { textSample = (await r.text()).slice(0, 200); } catch {}
		}
		const isHtml = /text\/html/.test(contentType) || /<html|<body|<!doctype/i.test(textSample);
		if (isHtml) return { ok: false, status, reason: 'html_response', keys: [], contentType, textSample };
		if (status === 401 || status === 403) return { ok: false, status, reason: `status:${status}`, keys: [], contentType };
		if (status !== 200) return { ok: false, status, reason: `status:${status}`, keys: [], contentType };
		const isObject = json && typeof json === 'object' && !Array.isArray(json);
		if (!isObject) return { ok: false, status, reason: 'invalid_json', keys: [], contentType };
		const keys = Object.keys(json || {});
		const required = ['billingCycleStart', 'billingCycleEnd', 'membershipType'];
		const hasRequired = required.every(k => k in (json || {}));
		if (!hasRequired) return { ok: false, status, reason: 'missing_fields', keys, contentType };
		const usageSummary = {
			membershipType: (json as any).membershipType,
			billingCycleStart: (json as any).billingCycleStart,
			billingCycleEnd: (json as any).billingCycleEnd,
		};
		return { ok: true, status, reason: 'api_ok', keys, contentType, usageSummary };
	} catch (e) {
		return { ok: false, status: 0, reason: `fetch_error:${e instanceof Error ? e.message : String(e)}`, keys: [], contentType: '' };
	}
}

// HTTP-based live check; persists cookies if valid and updates auth state
/**
 * runHttpLiveCheck
 *
 * Purpose:
 * - Perform a live check of uploaded cookies (if present), otherwise fallback to stored cookies
 *   from the canonical state. On success, persists uploaded cookies and updates auth status.
 *
 * Inputs:
 * - sessionData: any (uploaded artifact; used to extract cookie candidates).
 *
 * Outputs:
 * - { isAuthenticated, hasUser, status, reason, keys, contentType, sessionDetection, usageSummary }
 */
export async function runHttpLiveCheck(sessionData: any) {
	try {
		const env = {
			CURSOR_AUTH_STATE_DIR: process.env.CURSOR_AUTH_STATE_DIR || './data'
		};
		const authManager = new CursorAuthManager(env.CURSOR_AUTH_STATE_DIR);
		const sessionDetection = detectAuthFromSession(sessionData);

		// Merge cookies: uploaded first, falling back to stored
		const uploaded = extractCookiesFromSession(sessionData);
		const stored = (await authManager.loadState())?.sessionCookies || [];
		const combined = uploaded.length > 0 ? uploaded : stored;

		// Prefer shared validation via cookie header
		const apiProof = await checkUsageSummaryWithCookies(combined);
		console.log('API proof (HTTP): GET /api/usage-summary →', apiProof.status, '| keys:', (apiProof.keys || []).join(','), '| reason:', apiProof.reason);

		if (apiProof.ok) {
			// Persist uploaded cookies if present; otherwise keep stored as-is
			if (uploaded.length > 0) {
				try { await authManager.saveSessionCookiesRaw(uploaded as any); } catch (e) { console.warn('runHttpLiveCheck: saving raw cookies failed:', e); }
			} else {
				await authManager.updateAuthStatus(true);
			}
			return {
				isAuthenticated: true,
				hasUser: true,
				status: apiProof.status,
				reason: apiProof.reason,
				keys: apiProof.keys,
				contentType: apiProof.contentType,
				sessionDetection,
				usageSummary: (apiProof as any).usageSummary
			};
		}

		await authManager.updateAuthStatus(false, apiProof.reason);
		return {
			isAuthenticated: false,
			hasUser: false,
			status: apiProof.status,
			reason: apiProof.reason,
			keys: apiProof.keys,
			contentType: apiProof.contentType,
			sessionDetection,
			usageSummary: null
		};
	} catch (err) {
		console.error('runHttpLiveCheck: failed:', err);
		return { isAuthenticated: false, hasUser: false, status: null, reason: err instanceof Error ? err.message : String(err), keys: [], contentType: '' };
	}
}



