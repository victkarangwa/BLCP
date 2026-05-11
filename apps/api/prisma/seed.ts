/* eslint-disable no-console */
/**
 * Database seed.
 *
 * Run with:  npm run prisma:seed
 *
 * Two phases:
 *   1. Plain Prisma — creates the 7 named users (admin, applicants,
 *      reviewers, approvers). Uses argon2id with the same parameters
 *      AuthService uses, so login works against seeded credentials.
 *
 *   2. NestJS context — boots a minimal application context so we can call
 *      ApplicationsService.create and WorkflowService.transition directly.
 *      This way every seeded application has an authentic audit chain —
 *      we don't fake the history, we replay it.
 *
 * Idempotency: removes existing rows whose email ends with `@bnr.seed` and
 * recreates them. Production data won't carry this suffix.
 */

import 'dotenv/config';

import { PrismaClient, UserRole, ApplicationState } from '@prisma/client';
import * as argon2 from 'argon2';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../src/app.module';
import { ApplicationsService } from '../src/modules/applications/applications.service';
import { WorkflowService } from '../src/modules/applications/workflow/workflow.service';
import { WorkflowAction } from '../src/modules/applications/workflow/transitions';
import type { AuthenticatedUser } from '../src/modules/auth/strategies/jwt.strategy';

// Quiet Nest's normal boot logs during seeding; we want the seed's own
// progress messages to be the visible signal.
Logger.overrideLogger(['error', 'warn']);

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL,
    },
  },
});

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const SEED_PASSWORD = 'Passw0rd!ChangeMe';
const SEED_SUFFIX = '@bnr.seed';

interface SeedUserSpec {
  email: string;
  fullName: string;
  role: UserRole;
}

const SEED_USERS: SeedUserSpec[] = [
  { email: 'admin' + SEED_SUFFIX,      fullName: 'Admin User',         role: UserRole.ADMIN },
  { email: 'applicant1' + SEED_SUFFIX, fullName: 'Equity Bank Rwanda', role: UserRole.APPLICANT },
  { email: 'applicant2' + SEED_SUFFIX, fullName: 'Bank of Kigali',     role: UserRole.APPLICANT },
  { email: 'reviewer1' + SEED_SUFFIX,  fullName: 'Reviewer Alpha',     role: UserRole.REVIEWER },
  { email: 'reviewer2' + SEED_SUFFIX,  fullName: 'Reviewer Beta',      role: UserRole.REVIEWER },
  { email: 'approver1' + SEED_SUFFIX,  fullName: 'Approver One',       role: UserRole.APPROVER },
  { email: 'approver2' + SEED_SUFFIX,  fullName: 'Approver Two',       role: UserRole.APPROVER },
];

/**
 * Build the AuthenticatedUser shape services expect. In a real request this
 * is set by JwtStrategy; in the seed we synthesize it from the DB row.
 * sessionId is a dummy because nothing in the workflow path reads it.
 */
function asAuthUser(user: {
  id: string; email: string; fullName: string; role: UserRole;
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    sessionId: 'seed',
  };
}

const META = { ipAddress: '127.0.0.1', userAgent: 'seed-script' };

async function clearSeedData() {
  // Order matters: delete child rows before parents to satisfy FK constraints.
  await prisma.auditLog.deleteMany({
    where: { actorEmail: { endsWith: SEED_SUFFIX } },
  });
  // Audit rows referencing seed apps but anonymous (failed logins) — keep clean
  await prisma.auditLog.deleteMany({
    where: { application: { applicant: { email: { endsWith: SEED_SUFFIX } } } },
  });
  await prisma.idempotencyKey.deleteMany({
    where: { user: { email: { endsWith: SEED_SUFFIX } } },
  });
  await prisma.document.deleteMany({
    where: { uploadedBy: { email: { endsWith: SEED_SUFFIX } } },
  });
  await prisma.application.deleteMany({
    where: { applicant: { email: { endsWith: SEED_SUFFIX } } },
  });
  await prisma.session.deleteMany({
    where: { user: { email: { endsWith: SEED_SUFFIX } } },
  });
  await prisma.user.deleteMany({
    where: { email: { endsWith: SEED_SUFFIX } },
  });
}

async function seedUsers(): Promise<Record<string, { id: string; email: string; fullName: string; role: UserRole }>> {
  const passwordHash = await argon2.hash(SEED_PASSWORD, ARGON2_OPTIONS);

  await prisma.user.createMany({
    data: SEED_USERS.map((u) => ({ ...u, passwordHash })),
  });

  const all = await prisma.user.findMany({
    where: { email: { endsWith: SEED_SUFFIX } },
    select: { id: true, email: true, fullName: true, role: true },
  });

  // Key by the local-part of the email for convenience (e.g., 'admin', 'applicant1').
  const map: Record<string, typeof all[number]> = {};
  for (const u of all) {
    const key = u.email.split('@')[0];
    map[key] = u;
  }
  return map;
}

async function seedApplications(users: Awaited<ReturnType<typeof seedUsers>>) {
  // Boot a minimal Nest context to grab the services. createApplicationContext
  // (vs. NestFactory.create) skips the HTTP listener and lifecycle hooks for
  // controllers — exactly what we want for a script.
  const app = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: true,
    bufferLogs: true,
  });

  try {
    const applications = app.get(ApplicationsService);
    const workflow = app.get(WorkflowService);

    const applicant1 = asAuthUser(users.applicant1);
    const applicant2 = asAuthUser(users.applicant2);
    const reviewer1 = asAuthUser(users.reviewer1);
    const reviewer2 = asAuthUser(users.reviewer2);
    const approver1 = asAuthUser(users.approver1);

    // Helper: create + run a sequence of transitions. Returns the final
    // row so we can chain (each transition needs the latest version).
    const driveTo = async (
      applicantUser: AuthenticatedUser,
      institutionName: string,
      licenseType: string,
      steps: Array<{ user: AuthenticatedUser; action: WorkflowAction; reason?: string }>,
    ) => {
      let app = await applications.create(
        { institutionName, licenseType },
        applicantUser,
        META,
      );
      for (const step of steps) {
        app = await workflow.transition({
          applicationId: app.id,
          action: step.action,
          expectedVersion: app.version,
          user: step.user,
          reason: step.reason,
          ...META,
        });
      }
      return app;
    };

    // ── DRAFT: applicant1 starts something but hasn't submitted yet ──────
    await driveTo(applicant1, applicant1.fullName, 'COMMERCIAL_BANK', []);

    // ── SUBMITTED: applicant2 has submitted, no reviewer picked it up ────
    await driveTo(applicant2, applicant2.fullName, 'MICROFINANCE', [
      { user: applicant2, action: WorkflowAction.SUBMIT },
    ]);

    // ── UNDER_REVIEW: applicant1 submitted; reviewer1 picked it up ───────
    await driveTo(applicant1, applicant1.fullName, 'FOREX_BUREAU', [
      { user: applicant1, action: WorkflowAction.SUBMIT },
      { user: reviewer1, action: WorkflowAction.START_REVIEW },
    ]);

    // ── INFO_REQUESTED: full cycle paused awaiting more info from applicant
    await driveTo(applicant2, applicant2.fullName, 'COMMERCIAL_BANK', [
      { user: applicant2, action: WorkflowAction.SUBMIT },
      { user: reviewer2, action: WorkflowAction.START_REVIEW },
      {
        user: reviewer2,
        action: WorkflowAction.REQUEST_INFO,
        reason: 'Please provide audited financial statements for the last 3 fiscal years.',
      },
    ]);

    // ── APPROVED: clean approval path, used to demo terminal-state UI ────
    await driveTo(applicant1, 'Old Bank Co. (historical)', 'COMMERCIAL_BANK', [
      { user: applicant1, action: WorkflowAction.SUBMIT },
      { user: reviewer2, action: WorkflowAction.START_REVIEW },
      {
        user: approver1,
        action: WorkflowAction.APPROVE,
        reason: 'All regulatory requirements met. License granted with annual review condition.',
      },
    ]);

    // ── REJECTED: terminal in the other direction ────────────────────────
    // Demonstrates that approver can also REJECT after review.
    await driveTo(applicant2, 'Underfunded Bank Ltd.', 'COMMERCIAL_BANK', [
      { user: applicant2, action: WorkflowAction.SUBMIT },
      { user: reviewer1, action: WorkflowAction.START_REVIEW },
      {
        user: approver1,
        action: WorkflowAction.REJECT,
        reason: 'Insufficient capital reserves. Reapply after meeting the minimum capital requirement.',
      },
    ]);

    // ── RESUBMITTED: the full loop. Reviewer asks for info, applicant
    //    fixes the gap, resubmits, but no reviewer has picked it up again
    //    yet so it sits in RESUBMITTED — different state from INFO_REQUESTED.
    await driveTo(applicant1, 'Kigali Forex Services Ltd.', 'FOREX_BUREAU', [
      { user: applicant1, action: WorkflowAction.SUBMIT },
      { user: reviewer2, action: WorkflowAction.START_REVIEW },
      {
        user: reviewer2,
        action: WorkflowAction.REQUEST_INFO,
        reason: 'Please attach the directors\' KYC documents.',
      },
      {
        user: applicant1,
        action: WorkflowAction.RESUBMIT,
        reason: 'Attached director KYC documents as requested.',
      },
    ]);
  } finally {
    await app.close();
  }
}

async function main() {
  console.log('▶ Connecting to database…');

  console.log('▶ Removing previous seed data (if any)…');
  await clearSeedData();

  console.log('▶ Hashing seed password (argon2id, OWASP params)…');
  console.log('▶ Inserting users…');
  const users = await seedUsers();

  console.log('▶ Booting Nest context and seeding applications via WorkflowService…');
  await seedApplications(users);

  const apps = await prisma.application.findMany({
    where: { applicant: { email: { endsWith: SEED_SUFFIX } } },
    select: { referenceCode: true, state: true, institutionName: true },
    orderBy: { referenceCode: 'asc' },
  });
  const audits = await prisma.auditLog.count({
    where: { actorEmail: { endsWith: SEED_SUFFIX } },
  });

  console.log('');
  console.log('✓ Seed complete.');
  console.log('');
  console.log('  Users (password: ' + SEED_PASSWORD + '):');
  for (const u of SEED_USERS) {
    console.log('    ' + u.role.padEnd(10) + '  ' + u.email);
  }
  console.log('');
  console.log('  Applications:');
  for (const a of apps) {
    console.log('    ' + a.referenceCode + '  ' + a.state.padEnd(15) + '  ' + a.institutionName);
  }
  console.log('');
  console.log(`  Audit rows written: ${audits}`);
}

main()
  .catch((err) => {
    console.error('✗ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
