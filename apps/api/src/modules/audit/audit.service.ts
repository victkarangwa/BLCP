import { Injectable } from '@nestjs/common';
import {
  Prisma,
  AuditAction,
  ApplicationState,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Audit log writer.
 *
 * The service surface is the first layer of immutability: only `record()` and
 * `recordWithTx()` exist. There is no update method, no delete method.
 * If a developer wanted to mutate an audit row they'd have to bypass this
 * service and reach for prisma.auditLog.update() directly — which is a bright
 * red flag in code review and is also rejected at the database level: the
 * runtime DB role (bnr_app) has UPDATE/DELETE/TRUNCATE revoked on this table
 * (see migration 20260509000001_lockdown_audit_log).
 *
 * Two-method API:
 *   record()        — opens its own transaction. Used for standalone events
 *                     (login, logout, failed login).
 *   recordWithTx()  — uses the caller's transaction client. Used by services
 *                     that must commit the audit atomically with another DB
 *                     write — primarily WorkflowService.transition().
 */

export interface AuditEntry {
  /** null = anonymous (e.g., failed login attempt with unknown email). */
  actorId?: string | null;
  /**
   * Captured at write time, NOT joined from User at read time.
   * Reason: users get renamed/deactivated; the historical record must
   * reflect what was true at the moment of action.
   */
  actorEmail: string;
  /** null when actor is anonymous (no user → no role). */
  actorRole?: UserRole | null;

  action: AuditAction;
  applicationId?: string;
  previousState?: ApplicationState;
  newState?: ApplicationState;

  /** Free-form structured context (document hash, reason text, etc.). */
  metadata?: Record<string, unknown>;

  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Standalone audit write. Use for events that do not piggyback on another
   * DB mutation — login, logout, failed-login.
   */
  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({ data: this.toRow(entry) });
  }

  /**
   * In-transaction audit write. The caller passes their transaction client;
   * if the surrounding work fails, the audit row rolls back too. Either both
   * commit or neither.
   */
  async recordWithTx(
    tx: Prisma.TransactionClient,
    entry: AuditEntry,
  ): Promise<void> {
    await tx.auditLog.create({ data: this.toRow(entry) });
  }

  private toRow(entry: AuditEntry): Prisma.AuditLogCreateInput {
    return {
      actor: entry.actorId ? { connect: { id: entry.actorId } } : undefined,
      actorEmail: entry.actorEmail,
      actorRole: entry.actorRole ?? undefined,
      action: entry.action,
      application: entry.applicationId
        ? { connect: { id: entry.applicationId } }
        : undefined,
      previousState: entry.previousState,
      newState: entry.newState,
      metadata: entry.metadata as Prisma.InputJsonValue | undefined,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      // occurredAt deliberately omitted: DB default ensures server time,
      // not client time. Indelible timestamps are part of the legal record.
    };
  }
}
