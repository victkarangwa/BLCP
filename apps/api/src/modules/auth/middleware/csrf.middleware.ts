import {
  Injectable,
  NestMiddleware,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * CSRF protection via the double-submit cookie pattern.
 *
 *   - On login, the server sets a `bnr_csrf` cookie with a random value
 *     (NOT httpOnly, so JS can read it).
 *   - The frontend reads the cookie and echoes its value in the
 *     `X-CSRF-Token` header on every mutating request.
 *   - This middleware verifies the header matches the cookie. Mismatch → 403.
 *
 * Why this is safe:
 *   An attacker on evil.com can trigger a request to our API, but they
 *   cannot read our cookies (cross-origin cookie reads are forbidden by
 *   the browser). Without the cookie value, they can't forge the header.
 *   The match check fails → 403.
 *
 * Why we still need this with SameSite=Strict on the session cookie:
 *   SameSite is a strong defense, but not universally enforced (older
 *   clients, edge cases, browser bugs). Defense in depth: SameSite is
 *   layer 1, this is layer 2. Cost is one extra header, negligible.
 *
 * Skipped for:
 *   - Safe methods (GET, HEAD, OPTIONS) — they don't mutate state.
 *   - /auth/login — there's no session yet, so no cookie to compare against.
 *     Login is rate-limited per-IP, which is the appropriate protection
 *     for this endpoint.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Endpoints exempt from CSRF check.
//   /auth/login — no session yet, nothing to verify against.
//
// We match against suffix so the check works whether middleware sees the
// path with or without the /api/v1 prefix (Express middleware order vs.
// Nest's setGlobalPrefix can shift this depending on where we're applied).
const EXEMPT_SUFFIXES = ['/auth/login'];

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    if (SAFE_METHODS.has(req.method)) return next();

    const url = req.originalUrl ?? req.url ?? req.path;
    if (EXEMPT_SUFFIXES.some((suffix) => url.endsWith(suffix))) {
      return next();
    }

    const cookieToken = req.cookies?.bnr_csrf;
    const headerToken = req.headers['x-csrf-token'];

    if (
      !cookieToken ||
      !headerToken ||
      typeof headerToken !== 'string' ||
      cookieToken !== headerToken
    ) {
      throw new ForbiddenException({
        code: 'CSRF_TOKEN_MISMATCH',
        message: 'CSRF token missing or mismatched',
      });
    }
    next();
  }
}
