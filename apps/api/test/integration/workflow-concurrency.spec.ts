/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Concurrency integration test — the showstopper.
 *
 * Spec requirement: "A test that explicitly demonstrates your handling
 * of the concurrent access requirement."
 *
 * What we prove:
 *   Two reviewers click "Start Review" on the same SUBMITTED application
 *   at the same instant. Both load the page seeing version=0. Both POST
 *   their action with expectedVersion=0. The optimistic-lock mechanism
 *   (UPDATE … WHERE id=? AND version=?) ensures exactly ONE wins:
 *
 *     - 1 transition committed
 *     - 1 audit row written
 *     - version incremented to 1 (not 2)
 *     - state is UNDER_REVIEW (not double-applied)
 *     - the losing call rejected (the rejection is observable to the client)
 *
 * Why this matters: a regulator cannot accept a system where two clicks
 * could produce two approvals, or two audit entries claiming different
 * decisions. The optimistic-lock guarantee is the load-bearing property.
 *
 * Approach:
 *   - Boot a real NestJS context (not mocks) so the same WorkflowService
 *     the production app uses is what we exercise.
 *   - Use the dev database. Clean up via a per-test email suffix so we
 *     don't trample seed data.
 *   - Run TWO concurrent transition() calls via Promise.allSettled, then
 *     inspect the DB.
 *
 * Why not a fully separate test DB:
 *   - Setup cost. The dev DB is already migrated, role-configured, and
 *     running. A separate DB would mean a Jest globalSetup, role grants,
 *     and migration deployment per CI run. For the take-home, the
 *     trade-off favors leanness.
 *   - Isolation is achieved via the @bnr.test suffix — no production
 *     row (no real user) carries it, and we delete everything we created.
 */

import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  PrismaClient,
  UserRole,
  ApplicationState,
  AuditAction,
} from '@prisma/client';
import 'dotenv/config';

import { AppModule } from '../../src/app.module';
import { ApplicationsService } from '../../src/modules/applications/applications.service';
import { WorkflowService } from '../../src/modules/applications/workflow/workflow.service';
import { WorkflowAction } from '../../src/modules/applications/workflow/transitions';
import type { AuthenticatedUser } from '../../src/modules/auth/strategies/jwt.strategy';

const SUFFIX = '@bnr.test';

// Use the admin URL so we can clean up audit rows after the test
// (bnr_app can't DELETE from AuditLog — that's the point).
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL,
    },
  },
});

function asAuthUser(u: {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}): AuthenticatedUser {
  return { ...u, sessionId: 'test' };
}

describe('concurrent workflow transitions — exactly one wins', () => {
  let app: INestApplicationContext;
  let workflow: WorkflowService;
  let applications: ApplicationsService;
  let applicant: { id: string; email: string; fullName: string; role: UserRole };
  let reviewerA: { id: string; email: string; fullName: string; role: UserRole };
  let reviewerB: { id: string; email: string; fullName: string; role: UserRole };

  beforeAll(async () => {
    // createApplicationContext skips HTTP listener / lifecycle hooks for
    // controllers — fast enough for a test and exercises the same DI graph.
    app = await NestFactory.createApplicationContext(AppModule, {
      bufferLogs: true,
    });
    workflow = app.get(WorkflowService);
    applications = app.get(ApplicationsService);

    // Three test users keyed by the @bnr.test suffix so cleanup is selective.
    // We don't need real argon2 hashes here — these users never log in;
    // we synthesize AuthenticatedUser shapes directly.
    const ts = Date.now();
    [applicant, reviewerA, reviewerB] = await Promise.all([
      prisma.user.create({
        data: {
          email: `concurrency-applicant-${ts}${SUFFIX}`,
          passwordHash: 'not-used-in-test',
          fullName: 'Concurrency Applicant',
          role: UserRole.APPLICANT,
        },
      }),
      prisma.user.create({
        data: {
          email: `concurrency-reviewer-a-${ts}${SUFFIX}`,
          passwordHash: 'not-used-in-test',
          fullName: 'Reviewer A',
          role: UserRole.REVIEWER,
        },
      }),
      prisma.user.create({
        data: {
          email: `concurrency-reviewer-b-${ts}${SUFFIX}`,
          passwordHash: 'not-used-in-test',
          fullName: 'Reviewer B',
          role: UserRole.REVIEWER,
        },
      }),
    ]);
  }, 30_000);

  afterAll(async () => {
    // Cleanup, in FK-dependency order. We could TRUNCATE the @bnr.test
    // slice via a transaction but explicit deletes are easier to read.
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorEmail: { endsWith: SUFFIX } },
          { application: { applicant: { email: { endsWith: SUFFIX } } } },
        ],
      },
    });
    await prisma.application.deleteMany({
      where: { applicant: { email: { endsWith: SUFFIX } } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: SUFFIX } },
    });
    await app?.close();
    await prisma.$disconnect();
  }, 30_000);

  it('two simultaneous START_REVIEW calls — one wins, one gets 409, one audit row', async () => {
    // Arrange: a fresh SUBMITTED application owned by our applicant.
    // We create as DRAFT via the real service (which writes an audit row)
    // then transition to SUBMITTED — that gets us into the state both
    // racers will try to claim.
    const draft = await applications.create(
      { institutionName: 'Race Bank Ltd', licenseType: 'COMMERCIAL_BANK' },
      asAuthUser(applicant),
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    const submitted = await workflow.transition({
      applicationId: draft.id,
      action: WorkflowAction.SUBMIT,
      expectedVersion: draft.version,
      user: asAuthUser(applicant),
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(submitted.state).toBe(ApplicationState.SUBMITTED);
    expect(submitted.version).toBe(1);

    // Act: fire two transitions in parallel with the SAME expectedVersion.
    // Both believe they're acting on version=1. Only one can win.
    const results = await Promise.allSettled([
      workflow.transition({
        applicationId: submitted.id,
        action: WorkflowAction.START_REVIEW,
        expectedVersion: submitted.version,
        user: asAuthUser(reviewerA),
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      }),
      workflow.transition({
        applicationId: submitted.id,
        action: WorkflowAction.START_REVIEW,
        expectedVersion: submitted.version,
        user: asAuthUser(reviewerB),
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      }),
    ]);

    // Assert: exactly one fulfilled, exactly one rejected.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The losing call rejected with a 409-shaped error. The error code
    // can be either CONCURRENT_MODIFICATION (lost the version race) or
    // ILLEGAL_STATE_TRANSITION (loser's load saw the new state after
    // the winner committed) — both are correct outcomes from the
    // client's perspective: "this changed under me, refetch and decide."
    const loser = (rejected[0] as PromiseRejectedResult).reason;
    const loserPayload = loser?.response ?? loser;
    expect(['CONCURRENT_MODIFICATION', 'ILLEGAL_STATE_TRANSITION'])
      .toContain(loserPayload.code);

    // Assert DB state: row was updated exactly once, by one of the two reviewers.
    const final = await prisma.application.findUniqueOrThrow({
      where: { id: submitted.id },
    });
    expect(final.state).toBe(ApplicationState.UNDER_REVIEW);
    expect(final.version).toBe(2); // incremented from 1 exactly once
    expect([reviewerA.id, reviewerB.id]).toContain(final.reviewerId);

    // Assert audit chain: exactly one REVIEW_STARTED row for this app.
    // The losing call MUST NOT have written an audit entry, because the
    // audit write is in the same transaction as the state change — if
    // the state change rolled back (or the locked update returned 0
    // rows), the audit row doesn't exist either.
    const reviewStartedRows = await prisma.auditLog.findMany({
      where: {
        applicationId: submitted.id,
        action: AuditAction.REVIEW_STARTED,
      },
    });
    expect(reviewStartedRows).toHaveLength(1);
    expect(reviewStartedRows[0].actorId).toBe(final.reviewerId);
    expect(reviewStartedRows[0].previousState).toBe(ApplicationState.SUBMITTED);
    expect(reviewStartedRows[0].newState).toBe(ApplicationState.UNDER_REVIEW);
  }, 30_000);
});
