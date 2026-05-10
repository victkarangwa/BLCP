import {
  IsString,
  IsInt,
  Min,
  Max,
  MinLength,
  MaxLength,
  IsOptional,
  IsEnum,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApplicationState } from '@prisma/client';

/**
 * DTOs for the Applications module.
 *
 * Validation rules encode real policy:
 *   - Decision notes ≥ 10 chars (≥ 1 line of meaningful reason — legally defensible).
 *   - Info request notes ≥ 10 chars (applicant needs actionable guidance).
 *   - License type free-text per the README's "deliberately not built" list.
 */

export class CreateApplicationDto {
  @ApiProperty({ example: 'Equity Bank Rwanda' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  institutionName!: string;

  @ApiProperty({ example: 'COMMERCIAL_BANK' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  licenseType!: string;
}

export class UpdateApplicationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  institutionName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  licenseType?: string;
}

/**
 * Used by every transition endpoint. The client sends the version they
 * believe the row is at; the server uses it to detect concurrent modification.
 */
export class TransitionDto {
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

export class RequestInfoDto extends TransitionDto {
  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  note!: string;
}

export class ResubmitDto extends TransitionDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class DecideDto extends TransitionDto {
  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  note!: string;
}

export class ListApplicationsQuery {
  @ApiPropertyOptional({ enum: ApplicationState })
  @IsOptional()
  @IsEnum(ApplicationState)
  state?: ApplicationState;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
