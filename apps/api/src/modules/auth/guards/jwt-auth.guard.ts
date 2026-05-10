import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * JwtAuthGuard with @Public() opt-out.
 *
 * Registered as a global guard in main.ts: every endpoint requires auth
 * unless explicitly marked @Public(). This is the default-deny posture —
 * adding new endpoints can never accidentally skip auth.
 *
 * The actual JWT validation is done by Passport via JwtStrategy. This guard
 * just decides whether to invoke it.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
