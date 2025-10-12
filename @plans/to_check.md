# To check (manual verification list)

The following items I consider implemented; please verify them manually when you have time.

- AuthSession module (load, toHttpHeaders, preview, writeAtomically) is implemented at `packages/shared/cursor-auth/src/AuthSession.ts`.
- Upload pipeline: uploaded `SessionData` is persisted encrypted (diagnostics), `RawCookies` are derived, validated, and atomically written to `cursor.state.json` via `writeRawCookiesAtomic` (see `apps/web/app/api/auth/upload-session/route.ts`).
- Cookie filtering and header construction logic: `deriveRawCookiesFromSessionData` and `buildCookieHeader` with unit tests in `packages/shared/cursor-auth/src/AuthSession.test.ts`.
- File I/O and atomic-write tests: fixtures are placed in `packages/shared/cursor-auth/data/` and exercised by `AuthSession.test.ts`.
- HTTP contract tests (mocked) using undici MockAgent: `packages/shared/cursor-auth/src/AuthSession.integration.test.ts`.
- API route tests for `/api/auth/upload-session`: `apps/web/test/api/auth/route.test.ts`.
- Worker uses the same auth client and logs the same preview hash: `apps/worker/src/workers/scraper.ts`.
- CI wiring: `.github/workflows/ci.yml` updated to run package tests for `@cursor-usage/cursor-auth` and `@cursor-usage/web`.

Notes for verification:
- Run a scrape locally and confirm you see the sequence of logs:
  - `runScrape: env { CURSOR_AUTH_STATE_DIR: './data' }`
  - `runScrape: using alternative auth state dir (repo-root): /path/to/apps/web/data`
  - `cursor-auth: readRawCookies resolved dir: ...`
  - `cursor-auth: readRawCookies full path: ...`
  - `cursor-auth: readRawCookies file exists: ...`
  - `cursor-auth: readRawCookies cookie count: ...`
  - `cursor-auth: getAuthHeaders length: ...`
  - `cursor-auth: getAuthHeaders preview: ...`
  - `runScrape: auth session hash: ...`
  - `runScrape: captured count= ...`

If any of the above do not match your expectations, tell me which exact lines differ and I'll align them verbatim.
