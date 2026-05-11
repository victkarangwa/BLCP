import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-jwt';
import { Request } from 'express';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * JWT validation runs on every authenticated request.
 *
 * The signature check is done by passport-jwt before validate() runs.
 * Inside validate() we additionally:
 *
 *   1. Look up the Session row (revocation check). If a user was logged out
 *      or admin-deactivated, the row is gone and we 401.
 *
 *   2. Confirm the user is still active. Admin can flip isActive=false; we
 *      need to honor that immediately, not wait for the JWT to expire.
 *
 *   3. Confirm session.userId matches the JWT's sub. Belt-and-suspenders
 *      against malformed tokens (defense in depth).
 *
 * Returns the AuthenticatedUser shape attached to req.user — the only
 * representation of the current user other code should rely on.
 */

interface JwtPayload {
  sub: string;
  sid: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  /** Session id — needed for logout to delete the right row. */
  sessionId: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      // Read JWT from the httpOnly cookie, NOT the Authorization header.
      // Bearer tokens via Authorization header would defeat the XSS-resistance
      // we get from httpOnly cookies — JS would have to handle the token.
      jwtFromRequest: (req: Request): string | null =>
        readCookie(req, 'bnr_session') ?? null,
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });

    if (!session) throw new UnauthorizedException('Session revoked');
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired');
    }
    if (!session.user.isActive) {
      throw new UnauthorizedException('User deactivated');
    }
    if (session.userId !== payload.sub) {
      throw new UnauthorizedException('Session mismatch');
    }

    return {
      id: session.user.id,
      email: session.user.email,
      fullName: session.user.fullName,
      role: session.user.role,
      sessionId: session.id,
    };
  }
}

/**
 * Safe accessor for a cookie value. cookie-parser populates `req.cookies`
 * but @types/express doesn't model it; narrow through unknown rather than
 * `as` casting through a typed shape that would launder away `any`.
 */
function readCookie(req: Request, name: string): string | undefined {
  const cookies: unknown = (req as unknown as { cookies?: unknown }).cookies;
  if (typeof cookies !== 'object' || cookies === null) return undefined;
  const value = (cookies as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}
