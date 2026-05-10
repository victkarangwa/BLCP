import { SetMetadata } from '@nestjs/common';

/**
 * Mark an endpoint as public (skips JwtAuthGuard).
 *
 * The global JwtAuthGuard is default-deny: every endpoint requires auth
 * unless explicitly opted out. Use this only on endpoints that genuinely
 * cannot have an authenticated user — currently just /auth/login.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
