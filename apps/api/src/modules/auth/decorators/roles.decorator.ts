import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

/**
 * Restrict an endpoint to one or more roles.
 *
 *   @Roles(UserRole.APPROVER)
 *   @Post(':id/approve')
 *   approve(...) { ... }
 *
 * RolesGuard reads this metadata and 403s if the authenticated user's role
 * isn't in the list. This is the coarse filter — service code still applies
 * fine-grained checks (e.g., reviewer ≠ approver per-application).
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
