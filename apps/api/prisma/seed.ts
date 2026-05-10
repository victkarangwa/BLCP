/* eslint-disable no-console */
/**
 * Database seed.
 *
 * Run with:  npm run prisma:seed
 *
 * Connects with bnr_admin (DATABASE_ADMIN_URL or DATABASE_URL fallback) so
 * it can both insert into normal tables and audit (bnr_app would be enough
 * for the seed itself, but admin matches how seeds are invoked in CI/deploy).
 *
 * Idempotency: removes existing rows whose email ends with `@bnr.seed` and
 * recreates them. Safe to run repeatedly. Production data will not carry
 * this suffix, so the seed cannot accidentally clobber real users.
 *
 * Applications are NOT seeded here yet. Doing so would require either:
 *   (a) raw INSERTs that bypass the workflow rules — risks divergence from
 *       what the API would produce, and we'd need to fake audit entries, or
 *   (b) calling WorkflowService — which doesn't exist yet.
 *
 * We'll come back to this file after the workflow module is built and have
 * it call the real services. For now: users only. That's enough to log in
 * and exercise the auth surface.
 */

// Load .env (apps/api/.env) before reading process.env. The Prisma CLI
// loads .env automatically; ts-node does not, so we do it explicitly.
import 'dotenv/config';

import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL,
    },
  },
});

// Match AuthService.hashPassword exactly. If these drift, login breaks.
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const SEED_PASSWORD = 'Passw0rd!ChangeMe';
const SEED_SUFFIX = '@bnr.seed';

interface SeedUser {
  email: string;
  fullName: string;
  role: UserRole;
}

const SEED_USERS: SeedUser[] = [
  { email: 'admin' + SEED_SUFFIX,      fullName: 'Admin User',           role: UserRole.ADMIN },
  { email: 'applicant1' + SEED_SUFFIX, fullName: 'Equity Bank Rwanda',   role: UserRole.APPLICANT },
  { email: 'applicant2' + SEED_SUFFIX, fullName: 'Bank of Kigali',       role: UserRole.APPLICANT },
  { email: 'reviewer1' + SEED_SUFFIX,  fullName: 'Reviewer Alpha',       role: UserRole.REVIEWER },
  { email: 'reviewer2' + SEED_SUFFIX,  fullName: 'Reviewer Beta',        role: UserRole.REVIEWER },
  { email: 'approver1' + SEED_SUFFIX,  fullName: 'Approver One',         role: UserRole.APPROVER },
  { email: 'approver2' + SEED_SUFFIX,  fullName: 'Approver Two',         role: UserRole.APPROVER },
];

async function clearSeedData() {
  // Delete in dependency order so FK constraints don't trip.
  // Audit rows reference users; sessions reference users; etc.
  await prisma.auditLog.deleteMany({
    where: { actorEmail: { endsWith: SEED_SUFFIX } },
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

async function main() {
  console.log('▶ Connecting to database…');

  console.log('▶ Removing previous seed data (if any)…');
  await clearSeedData();

  console.log('▶ Hashing seed password (argon2id, OWASP params)…');
  const passwordHash = await argon2.hash(SEED_PASSWORD, ARGON2_OPTIONS);

  console.log('▶ Inserting users…');
  await prisma.user.createMany({
    data: SEED_USERS.map((u) => ({ ...u, passwordHash })),
  });

  console.log('');
  console.log('✓ Seed complete.');
  console.log('');
  console.log('  Login with any of the following (password: ' + SEED_PASSWORD + ')');
  console.log('');
  for (const u of SEED_USERS) {
    console.log('    ' + u.role.padEnd(10) + '  ' + u.email);
  }
  console.log('');
  console.log('  Applications will be seeded once the workflow module exists.');
}

main()
  .catch((err) => {
    console.error('✗ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
