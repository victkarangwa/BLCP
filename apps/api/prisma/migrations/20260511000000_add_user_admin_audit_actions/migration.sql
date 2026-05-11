-- Add USER_CREATED and USER_UPDATED to the AuditAction enum so admin
-- user-management actions get first-class audit entries (not a sentinel
-- USER_LOGGED_IN + metadata workaround).
--
-- Postgres 12+ supports adding multiple enum values in one migration.
-- We're on 16.

ALTER TYPE "AuditAction" ADD VALUE 'USER_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'USER_UPDATED';
