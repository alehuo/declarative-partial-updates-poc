import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const SECRET: Buffer = process.env.CSRF_SECRET
  ? Buffer.from(process.env.CSRF_SECRET)
  : crypto.randomBytes(32); // tokens become invalid on restart, which is fine for a PoC

const SID_COOKIE = 'sid';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Per-request CSP nonce + security headers. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.nonce = nonce;
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      `script-src 'nonce-${nonce}' 'strict-dynamic'`,
      "style-src 'self'",
      "img-src 'self' data:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  next();
}

/** Ensures every visitor has an anonymous session id the CSRF token is bound to. */
export function session(req: Request, res: Response, next: NextFunction): void {
  let sid: unknown = req.cookies?.[SID_COOKIE];
  if (typeof sid !== 'string' || !/^[A-Za-z0-9_-]{22,}$/.test(sid)) {
    sid = crypto.randomBytes(18).toString('base64url');
    res.cookie(SID_COOKIE, sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      path: '/',
    });
  }
  if (sid !== req.cookies?.[SID_COOKIE]) res.locals.log.debug('new session issued');
  req.sid = sid as string;
  next();
}

const hmac = (sid: string, salt: string): string =>
  crypto.createHmac('sha256', SECRET).update(`${sid}.${salt}`).digest('base64url');

/** Issues a fresh (salted) token bound to the session id. Stateless: no server storage. */
export function issueCsrfToken(sid: string): string {
  const salt = crypto.randomBytes(16).toString('base64url');
  return `${salt}.${hmac(sid, salt)}`;
}

function verifyCsrfToken(sid: string, token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const [salt, mac] = token.split('.');
  if (!salt || !mac) return false;
  const expected = Buffer.from(hmac(sid, salt));
  const given = Buffer.from(mac);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** Rejects unsafe requests without a valid token or coming from another site. */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  res.locals.csrfToken = () => issueCsrfToken(req.sid);
  if (SAFE_METHODS.has(req.method)) return next();

  const site = req.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') return forbid(req, res, 'cross-site request', { site });

  const origin = req.get('Origin');
  if (origin && origin !== `${req.protocol}://${req.get('Host')}`) return forbid(req, res, 'origin mismatch', { origin });

  const token: unknown = req.get('X-CSRF-Token') ?? req.body?._csrf;
  if (!verifyCsrfToken(req.sid, token)) return forbid(req, res, token ? 'invalid CSRF token' : 'missing CSRF token');
  next();
}

function forbid(req: Request, res: Response, reason: string, fields?: Record<string, unknown>): void {
  // Never log the token or session id themselves.
  res.locals.log.warn(`CSRF check failed: ${reason}`, { method: req.method, path: req.originalUrl, ...fields });
  res.status(403).type('text/plain').send(`Forbidden: ${reason}`);
}
