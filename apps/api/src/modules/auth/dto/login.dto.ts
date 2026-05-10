import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Login input.
 *
 * Validation rules encode real policy:
 *   - MinLength(12) on password matches NIST SP 800-63B guidance.
 *   - MaxLength(128) prevents DoS via expensive argon2 calls on huge inputs.
 *   - MaxLength(254) on email matches RFC 5321's address length limit.
 */
export class LoginDto {
  @ApiProperty({ example: 'reviewer@bnr.rw' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
