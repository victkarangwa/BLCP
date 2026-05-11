import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '@prisma/client';

import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto, ListUsersQuery } from './dto';

/**
 * Admin user-management endpoints.
 *
 *   GET    /users        list users (paginated)
 *   POST   /users        create a new user (with strong password)
 *   PATCH  /users/:id    update fullName / role / isActive
 *
 * All admin-only. Deactivating a user immediately revokes their sessions
 * (UsersService handles it in the same transaction) — so a fired employee
 * loses access on the next request, not when their JWT expires.
 */
@ApiTags('users')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users (admin only)' })
  async list(@Query() query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new user (admin only)' })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.users.create(dto, admin, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a user (admin only)' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.users.update(id, dto, admin, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
