import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Prisma, UserRole } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { applicationVisibilityFilter } from '../applications/visibility';
import { AuditQueryDto } from './dto/audit-query.dto';

/**
 * Audit read endpoints.
 *
 *   GET /audit/applications/:id  — visible to insiders on this application
 *                                  (applicant, assigned reviewer/approver, admin).
 *                                  Returns the chronological audit chain.
 *
 *   GET /audit                   — admin only. System-wide search with filters
 *                                  (actorId, action, applicationId, date range).
 *
 * Both paginate via cursor (id of the last row). 50-row default, 200 max.
 *
 * The Audit module is intentionally append-only: the service has no update
 * or delete methods, and the bnr_app DB role has UPDATE/DELETE/TRUNCATE
 * revoked on the AuditLog table. These read endpoints don't change that.
 */
@ApiTags('audit')
@UseGuards(RolesGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  // ── Application-scoped trail ─────────────────────────────────────────

  @Get('applications/:id')
  @ApiOperation({
    summary: 'Audit trail for a specific application (insiders only)',
  })
  async forApplication(
    @Param('id') applicationId: string,
    @Query() query: AuditQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const app = await this.prisma.application.findFirst({
      where: {
        id: applicationId,
        ...applicationVisibilityFilter(user),
      },
      select: { id: true },
    });
    if (!app) throw new NotFoundException();

    return this.paginate({ applicationId }, query);
  }

  // ── System-wide search (admin) ───────────────────────────────────────

  @Roles(UserRole.ADMIN)
  @Get()
  @ApiOperation({
    summary: 'System-wide audit search (admin only)',
  })
  async search(@Query() query: AuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorId && { actorId: query.actorId }),
      ...(query.applicationId && { applicationId: query.applicationId }),
      ...(query.action && { action: query.action }),
      ...((query.from || query.to) && {
        occurredAt: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lte: new Date(query.to) }),
        },
      }),
    };
    return this.paginate(where, query);
  }

  // ── Shared cursor pagination ─────────────────────────────────────────

  private async paginate(
    where: Prisma.AuditLogWhereInput,
    query: AuditQueryDto,
  ) {
    const limit = Math.min(query.limit ?? 50, 200);

    // Fetch limit+1 to know if there's a next page without a separate
    // COUNT query.
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        actorId: true,
        actorEmail: true,
        actorRole: true,
        action: true,
        applicationId: true,
        previousState: true,
        newState: true,
        metadata: true,
        ipAddress: true,
        userAgent: true,
        occurredAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: trimmed,
      nextCursor: hasMore ? trimmed[trimmed.length - 1].id : null,
    };
  }
}
