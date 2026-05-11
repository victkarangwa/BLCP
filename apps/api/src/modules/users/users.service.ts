import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma, User, UserRole, AuditAction } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateUserDto, UpdateUserDto, ListUsersQuery } from './dto';

/**
 * UsersService — credential lookup + admin user management.
 *
 *   findByEmail / findById — used by AuthService at login time. Returns
 *     the full User row including passwordHash; callers must never expose
 *     this row to controllers/responses.
 *
 *   create / list / update — admin endpoints. Controllers select only
 *     safe fields for responses.
 *
 * Argon2 parameters match AuthService (OWASP 2024 recommendation). They
 * MUST match, or seeded/admin-created users can't log in. We keep the
 * params here to avoid an AuthModule import (would cycle: AuthModule
 * already imports UsersModule). If they ever drift, the smoke test for
 * login-after-admin-create will catch it.
 */

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Lookups used by AuthService ──────────────────────────────────────

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  // ── Admin CRUD ───────────────────────────────────────────────────────

  /**
   * Create a new user with a hashed password.
   *
   * Returns safe fields only (no passwordHash). The audit row records
   * the actor (admin), the new user's id, and their assigned role.
   */
  async create(
    dto: CreateUserDto,
    admin: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);

    // Unique-email collisions surface as P2002 from Prisma; the global
    // exception filter already maps those to 409 DUPLICATE_RESOURCE.
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          fullName: dto.fullName,
          role: dto.role,
        },
        select: this.safeUserSelect,
      });

      await this.audit.recordWithTx(tx, {
        actorId: admin.id,
        actorEmail: admin.email,
        actorRole: admin.role,
        action: AuditAction.USER_CREATED,
        metadata: {
          subjectUserId: created.id,
          subjectEmail: created.email,
          subjectRole: created.role,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return created;
    });

    return user;
  }

  async list(query: ListUsersQuery) {
    const limit = Math.min(query.limit ?? 50, 200);

    const where: Prisma.UserWhereInput = {
      ...(query.role && { role: query.role }),
    };

    const items = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: this.safeUserSelect,
    });

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    return {
      items: trimmed,
      nextCursor: hasMore ? trimmed[trimmed.length - 1].id : null,
    };
  }

  /**
   * Update fullName, role, or active state.
   *
   * The critical bit: if isActive becomes false, we delete ALL the user's
   * sessions in the same transaction. This is the "fired employee gets
   * locked out NOW" property — the next request they make finds no
   * session row and returns 401.
   *
   * Admin self-protection: an admin cannot deactivate themselves or
   * demote themselves to a non-admin role. Without this, the last admin
   * could lock everyone out (including themselves) with no recovery path.
   */
  async update(
    id: string,
    dto: UpdateUserDto,
    admin: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    if (id === admin.id) {
      if (dto.isActive === false) {
        throw new ForbiddenException(
          'Admins cannot deactivate their own account',
        );
      }
      if (dto.role && dto.role !== UserRole.ADMIN) {
        throw new ForbiddenException('Admins cannot demote their own role');
      }
    }

    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          ...(dto.fullName !== undefined && { fullName: dto.fullName }),
          ...(dto.role !== undefined && { role: dto.role }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
        select: this.safeUserSelect,
      });

      // Revoke sessions on deactivation. Also revoke on role change so
      // the old role isn't carried in the JWT for up to an hour.
      const becameInactive =
        dto.isActive === false && existing.isActive === true;
      const roleChanged = dto.role !== undefined && dto.role !== existing.role;

      if (becameInactive || roleChanged) {
        await tx.session.deleteMany({ where: { userId: id } });
      }

      // Build a diff metadata payload so audit reads tell exactly what
      // changed without exposing sensitive fields.
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (dto.fullName !== undefined && dto.fullName !== existing.fullName) {
        changes.fullName = { from: existing.fullName, to: dto.fullName };
      }
      if (dto.role !== undefined && dto.role !== existing.role) {
        changes.role = { from: existing.role, to: dto.role };
      }
      if (dto.isActive !== undefined && dto.isActive !== existing.isActive) {
        changes.isActive = { from: existing.isActive, to: dto.isActive };
      }

      await this.audit.recordWithTx(tx, {
        actorId: admin.id,
        actorEmail: admin.email,
        actorRole: admin.role,
        action: AuditAction.USER_UPDATED,
        metadata: {
          subjectUserId: id,
          subjectEmail: existing.email,
          changes,
          sessionsRevoked: becameInactive || roleChanged,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return updated;
    });
  }

  // ── Internals ────────────────────────────────────────────────────────

  /**
   * Safe field set for responses. NEVER include passwordHash here, even
   * if a future field looks innocuous.
   */
  private readonly safeUserSelect = {
    id: true,
    email: true,
    fullName: true,
    role: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
  } as const;
}
