import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
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

import { ApplicationsService } from './applications.service';
import { WorkflowService } from './workflow/workflow.service';
import { WorkflowAction } from './workflow/transitions';
import {
  CreateApplicationDto,
  UpdateApplicationDto,
  ListApplicationsQuery,
  TransitionDto,
  RequestInfoDto,
  ResubmitDto,
  DecideDto,
} from './dto';

/**
 * Applications + workflow HTTP surface.
 *
 * URL design notes:
 *   - CRUD is resource-oriented (GET/POST /applications, GET/PATCH /:id).
 *   - Workflow actions are action sub-paths (POST /:id/approve etc.) —
 *     pragmatic over purely RESTful because it reads as the domain language.
 *   - @Roles is the HTTP-layer filter ("can this role even reach here?");
 *     the service still applies per-application rules.
 */
@ApiTags('applications')
@UseGuards(RolesGuard)
@Controller('applications')
export class ApplicationsController {
  constructor(
    private readonly apps: ApplicationsService,
    private readonly workflow: WorkflowService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────

  @Roles(UserRole.APPLICANT)
  @Post()
  @ApiOperation({ summary: 'Create a new application in DRAFT' })
  async create(
    @Body() dto: CreateApplicationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.apps.create(dto, user, this.meta(req));
  }

  @Get()
  @ApiOperation({ summary: 'List applications visible to the current user' })
  async list(
    @Query() query: ListApplicationsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.apps.list(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single application' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.apps.findOne(id, user);
  }

  @Roles(UserRole.APPLICANT)
  @Patch(':id')
  @ApiOperation({ summary: 'Edit a DRAFT application' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateApplicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.apps.update(id, dto, user);
  }

  @Get(':id/available-actions')
  @ApiOperation({
    summary: 'What actions can the current user perform on this application?',
  })
  async availableActions(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.apps.availableActionsFor(id, user);
  }

  // ── Workflow actions ──────────────────────────────────────────────────
  // Each is a thin wrapper around WorkflowService.transition. The service
  // does all the heavy lifting; the controller just shapes input/output.

  @Roles(UserRole.APPLICANT)
  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit a DRAFT application for review' })
  async submit(
    @Param('id') id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.workflow.transition({
      applicationId: id,
      action: WorkflowAction.SUBMIT,
      expectedVersion: dto.expectedVersion,
      user,
      ...this.meta(req),
    });
  }

  @Roles(UserRole.REVIEWER)
  @Post(':id/start-review')
  @ApiOperation({ summary: 'Start (or resume) review of an application' })
  async startReview(
    @Param('id') id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.workflow.transition({
      applicationId: id,
      action: WorkflowAction.START_REVIEW,
      expectedVersion: dto.expectedVersion,
      user,
      ...this.meta(req),
    });
  }

  @Roles(UserRole.REVIEWER)
  @Post(':id/request-info')
  @ApiOperation({ summary: 'Request more information from the applicant' })
  async requestInfo(
    @Param('id') id: string,
    @Body() dto: RequestInfoDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.workflow.transition({
      applicationId: id,
      action: WorkflowAction.REQUEST_INFO,
      expectedVersion: dto.expectedVersion,
      user,
      reason: dto.note,
      ...this.meta(req),
    });
  }

  @Roles(UserRole.APPLICANT)
  @Post(':id/resubmit')
  @ApiOperation({
    summary: 'Resubmit after requested information was provided',
  })
  async resubmit(
    @Param('id') id: string,
    @Body() dto: ResubmitDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.workflow.transition({
      applicationId: id,
      action: WorkflowAction.RESUBMIT,
      expectedVersion: dto.expectedVersion,
      user,
      reason: dto.note,
      ...this.meta(req),
    });
  }

  @Roles(UserRole.APPROVER)
  @Post(':id/approve')
  @ApiOperation({ summary: 'Issue final approval' })
  async approve(
    @Param('id') id: string,
    @Body() dto: DecideDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.workflow.transition({
      applicationId: id,
      action: WorkflowAction.APPROVE,
      expectedVersion: dto.expectedVersion,
      user,
      reason: dto.note,
      ...this.meta(req),
    });
  }

  @Roles(UserRole.APPROVER)
  @Post(':id/reject')
  @ApiOperation({ summary: 'Issue final rejection' })
  async reject(
    @Param('id') id: string,
    @Body() dto: DecideDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.workflow.transition({
      applicationId: id,
      action: WorkflowAction.REJECT,
      expectedVersion: dto.expectedVersion,
      user,
      reason: dto.note,
      ...this.meta(req),
    });
  }

  private meta(req: Request) {
    return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
  }
}
