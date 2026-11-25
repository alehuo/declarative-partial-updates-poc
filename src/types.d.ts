import type { Logger } from './log.ts';

// Express augmentations for values the middleware in security.ts attaches.
declare global {
  namespace Express {
    interface Request {
      /** Anonymous session id the CSRF token is bound to. */
      sid: string;
    }
    interface Locals {
      /** Per-request CSP nonce. */
      nonce: string;
      /** Issues a fresh CSRF token for the current session. */
      csrfToken: () => string;
      /** Request-scoped logger (tagged with the request id). */
      log: Logger;
      /** Milliseconds since the request started. */
      elapsed: () => number;
    }
  }
}

export {};
