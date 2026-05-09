-- ─────────────────────────────────────────────────────────────────────────────
--  Hand-written migration: invariants Prisma's DSL cannot express.
--
--  This migration runs AFTER the auto-generated init migration that creates
--  the tables. It adds:
--
--    1. CHECK constraint: reviewer ≠ approver on the same Application row.
--       Defence in depth — even if app-level guards are buggy, the DB rejects.
--
--    2. Postgres sequence for human-readable application reference codes
--       (BLCP-2026-00042). Atomic via nextval(), no race conditions.
--
--    3. Permission grants for the bnr_app runtime role.
--       Critical: bnr_app gets SELECT+INSERT on AuditLog but NOT
--       UPDATE/DELETE/TRUNCATE. This is the database-level enforcement
--       of audit-log immutability we promise to regulators.
--
--  Migrations themselves are run as the schema owner (bnr_admin), which
--  has full DDL — that's why the GRANT/REVOKE statements work here.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Reviewer ≠ Approver ──────────────────────────────────────────────────
ALTER TABLE "Application"
  ADD CONSTRAINT "reviewer_not_approver"
  CHECK (
    "reviewerId" IS NULL
    OR "approverId" IS NULL
    OR "reviewerId" <> "approverId"
  );

-- ── 2. Reference-code sequence ──────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS application_reference_seq START 1;

-- ── 3. Runtime role permissions ─────────────────────────────────────────────
-- The bnr_app role exists from docker/postgres/init-roles.sql.
-- Grant it the access it needs — and only that.

GRANT USAGE ON SCHEMA public TO bnr_app;

-- Full DML on operational tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "User",
  "Session",
  "Application",
  "Document",
  "IdempotencyKey"
  TO bnr_app;

-- AuditLog: SELECT + INSERT only. No UPDATE, DELETE, or TRUNCATE.
-- This is the backbone of the audit-immutability claim.
GRANT SELECT, INSERT ON "AuditLog" TO bnr_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM bnr_app;

-- Sequences (for default UUIDs, the reference sequence, etc.).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bnr_app;

-- Future tables added by later migrations need this too. Sets the default
-- for objects bnr_admin creates from now on.
ALTER DEFAULT PRIVILEGES FOR ROLE bnr_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bnr_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bnr_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO bnr_app;
