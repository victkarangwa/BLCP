import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { AuditAction, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';

/**
 * AuthService — login and logout.
 *
 * Security-critical decisions documented inline. Read carefully if changing
 * any of this; subtle bugs here are exactly the kind a regulator would find.
 */

interface LoginContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface LoginResult {
  jwt: string;
  csrfToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
  };
  expiresAt: Date;
}

/**
 * Pre-computed argon2id hash. Used by the constant-time path when the email
 * doesn't exist in the database — verifying against this dummy keeps login
 * timing identical regardless of whether the email is registered, defeating
 * email-enumeration via timing analysis.
 *
 * The plaintext for this hash is irrelevant; we never accept it as a valid
 * password (that path is the "no user found" branch which always fails). It
 * just needs to be a real argon2id hash so verify() exercises the same code.
 *
 * Generated once with: argon2.hash('not-a-real-password', { type: argon2id }).
 * Hardcoding it avoids generating a new one on every cold start.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$' +
  'c29tZS1zYWx0LXZhbHVlLWZvci1kdW1teS0yMDI2$' +
  'kPxDVOFvrFC7GmVxYBfnCGjQNh6zpjZmbYxqJqJpGJ4';

/** Argon2 parameters per OWASP 2024 recommendations. */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

/** Session lifetime: 1 hour. Matches JWT exp. No refresh tokens by design. */
const SESSION_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Authenticate the user and mint a session.
   *
   * Three failure modes — wrong email, wrong password, deactivated user —
   * all return the SAME 401 with the same generic message. This is
   * deliberate: distinguishing them leaks information to attackers
   * (does this email exist? is this account active?). The cost is slightly
   * worse UX for legitimate forgetters, which is acceptable.
   *
   * Failed attempts are audited regardless. The audit captures the attempted
   * email so security teams can detect targeted attacks even when the
   * client-facing response is uniform.
   */
  async login(
    email: string,
    password: string,
    ctx: LoginContext,
  ): Promise<LoginResult> {
    const user = await this.users.findByEmail(email);

    // Constant-time path: always run argon2.verify, even if user is null.
    // Otherwise the response time for "no such email" (no argon2) differs
    // measurably from "wrong password" (argon2 ~50ms), letting an attacker
    // enumerate registered emails by timing.
    const hashToCheck = user?.passwordHash ?? DUMMY_HASH;
    let passwordOk = false;
    try {
      passwordOk = await argon2.verify(hashToCheck, password);
    } catch {
      // argon2.verify throws on malformed hashes. Treat as "failed".
      passwordOk = false;
    }

    if (!user || !passwordOk || !user.isActive) {
      // Audit the failed attempt. Capture the attempted email, which is the
      // useful forensic field — it tells us *who they tried to be*, even when
      // the email doesn't correspond to a real user.
      await this.audit.record({
        actorId: null,
        actorEmail: email,
        actorRole: null,
        action: AuditAction.USER_LOGIN_FAILED,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: {
          // Why the attempt failed, for ops dashboards. Not exposed to client.
          reason: !user
            ? 'unknown_email'
            : !passwordOk
              ? 'wrong_password'
              : 'user_deactivated',
        },
      });

      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    // Happy path: create session, sign JWT, audit success.
    const csrfToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        csrfToken,
        expiresAt,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    const jwtToken = await this.jwt.signAsync({
      sub: user.id,
      sid: session.id,
      role: user.role,
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: AuditAction.USER_LOGGED_IN,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      jwt: jwtToken,
      csrfToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
      expiresAt,
    };
  }

  /**
   * End a session.
   *
   * Idempotent: deleting an already-gone session is fine — the user is in
   * the same end state either way. We swallow the not-found error so a
   * double-click on logout doesn't 500.
   */
  async logout(
    sessionId: string,
    actor: { id: string; email: string; role: UserRole },
    ctx: LoginContext,
  ): Promise<void> {
    try {
      await this.prisma.session.delete({ where: { id: sessionId } });
    } catch {
      // Already gone. Audit anyway so we have the record.
      this.logger.debug(`Logout for missing session ${sessionId}`);
    }

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: AuditAction.USER_LOGGED_OUT,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /**
   * Hash a password for storage. Used by user-creation flows (admin endpoints).
   * Centralized here so we have one place that knows the argon2 parameters.
   */
  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }
}
