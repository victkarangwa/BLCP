import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Form-data fields that come alongside the uploaded file.
 *
 * documentType is constrained to safe characters: uppercase letters,
 * digits, underscore, hyphen. This both keeps storage paths sane
 * (no slashes, no spaces, no traversal characters) and signals to
 * applicants that document types are categorical, not free prose.
 *
 * If/when BNR standardizes document types into an enum, we replace this
 * Matches() with @IsEnum() and migrate existing data.
 */
export class UploadDocumentMetaDto {
  @ApiProperty({ example: 'BUSINESS_PLAN' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'documentType must be uppercase letters, digits, underscores or hyphens',
  })
  documentType!: string;
}
