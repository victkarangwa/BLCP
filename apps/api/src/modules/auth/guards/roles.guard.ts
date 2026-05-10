import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../strategies/jwt.strategy';

/**
 * Coarse role gate. Reads @Roles() metadata and 403s if the authenticated
 * user's role isn't in the list.
 *
 * This is the HTTP-layer filter. Service code still applies fine-grained
 * checks (e.g., reviewer-≠-approver per application). Both layers exist
 * intentionally — defense in depth, and the service-layer check needs
 * IDs that the role-only check doesn't carry.
 *
 * Applied per-controller/handler with @UseGuards(RolesGuard), not globally.
 * Endpoints without @Roles() metadata pass through (the absence of metadata
 * means "any authenticated user," which the JwtAuthGuard already enforces).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as
      | AuthenticatedUser
      | undefined;
    if (!user) throw new ForbiddenException();

    if (!required.includes(user.role)) {
      throw new ForbiddenException(`Requires one of: ${required.join(', ')}`);
    }
    return true;
  }
}
