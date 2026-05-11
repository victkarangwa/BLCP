import {
  IsOptional,
  IsUUID,
  IsEnum,
  IsISO8601,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';

/**
 * Audit read filters.
 *
 *   - Cursor pagination (id of the last seen row) instead of offset.
 *     Audit logs grow unboundedly; offset becomes O(N) at depth, cursor
 *     stays O(log N). Cursor also doesn't shift on new inserts.
 *
 *   - limit capped at 200. Above that the response gets too large to
 *     stream comfortably, and reviewers should narrow their filters.
 *     Bulk export (CSV) is intentionally a separate feature, not in scope.
 */
export class AuditQueryDto {
  @ApiPropertyOptional({ description: 'Filter by actor user id' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ description: 'Filter by application id (also enforced as an existence check)' })
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ description: 'ISO 8601 inclusive lower bound on occurredAt' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 inclusive upper bound on occurredAt' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'id of the last row from the previous page' })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
