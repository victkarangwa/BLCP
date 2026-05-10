import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  HttpCode,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

/**
 * Auth endpoints.
 *
 *   POST /auth/login    Public, rate-limited. Sets cookies on success.
 *   POST /auth/logout   Authenticated. Clears cookies + session row.
 *   GET  /auth/me       Authenticated. Returns the current user.
 *
 * Cookie strategy:
 *   bnr_session   httpOnly, Secure (in prod), SameSite=Strict, holds JWT.
 *   bnr_csrf      readable by JS, SameSite=Strict, paired with X-CSRF-Token
 *                 header for the double-submit pattern (see CsrfMiddleware).
 *
 * `passthrough: true` on @Res lets us return JSON AND set cookies. Without
 * it, we'd have to call res.json() manually, which sidesteps Nest's
 * serialization pipeline.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  // Per-IP rate limit: 5 attempts per minute. Tighter than the default
  // throttler bucket. Per-account lockout would handle distributed attacks
  // better but introduces a DoS vector (anyone can lock anyone) — out of
  // scope for this take-home, documented in DESIGN.md as a future hardening.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Authenticate and receive session cookies' })
  @ApiResponse({ status: 200, description: 'Login successful — cookies set' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many attempts' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto.email, dto.password, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const isProd = process.env.NODE_ENV === 'production';
    const cookieBase = {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict' as const,
      path: '/',
      expires: result.expiresAt,
    };

    // Session cookie: httpOnly so JS can't read it.
    res.cookie('bnr_session', result.jwt, cookieBase);
    // CSRF cookie: NOT httpOnly — frontend JS reads it and echoes via header.
    res.cookie('bnr_csrf', result.csrfToken, {
      ...cookieBase,
      httpOnly: false,
    });

    return { user: result.user, expiresAt: result.expiresAt };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'End session and clear cookies' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(
      user.sessionId,
      { id: user.id, email: user.email, role: user.role },
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    );

    // Clear both cookies. clearCookie must use the same path as set, or
    // the browser silently keeps them around.
    res.clearCookie('bnr_session', { path: '/' });
    res.clearCookie('bnr_csrf', { path: '/' });
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };
  }
}
