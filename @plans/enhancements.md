# Auth Testing Enhancements & Non-test Functionality

These are enhancements and non-test features that were suggested and not yet fully implemented as automated tests. They are saved here for future work.

- Enhanced error reporting and metrics
  - Propose standardized error codes for auth failures (e.g., `AUTH_INVALID_COOKIES`, `AUTH_EXPIRED_SESSION`, `AUTH_UPSTREAM_ERROR`).
  - Integrate with monitoring system (e.g., Sentry or Prometheus) to track auth failure rates and reasons.

- Concurrency hardening
  - If multiple concurrent `SessionData` uploads are possible, consider adding file locks or a short-lived in-memory mutex around `FileSessionStore` operations to avoid racey `removeAllSessions` interactions.

- Session refresh UX tests
  - Integration tests for the session refresh behavior: upload SessionData → validate → verify `cursor.state.json` updated and worker picks it up.

- CI improvements
  - Add a smoke step that runs `pnpm --filter @cursor-usage/cursor-auth test` after build to ensure package tests pass in CI.

- Lint rule (ESLint plugin)
  - Implement a custom ESLint rule or use existing plugin to forbid direct `fetch('https://cursor.com')` outside the auth client module.

Each of these items can be prioritized and converted into concrete todos when you're ready to proceed.
