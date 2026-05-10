import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * UsersService — currently the read surface needed by AuthService.
 *
 * Admin endpoints (create user, deactivate, list) will be added later with
 * their own controller. Keeping this service minimal so the auth module can
 * boot without dragging in admin features it doesn't need.
 *
 * Note on naming: findByEmail returns the full User row including
 * passwordHash, because AuthService verifies the password. NEVER expose this
 * row directly to controllers — the controller layer should select fields
 * explicitly.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
