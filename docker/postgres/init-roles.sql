-- ─────────────────────────────────────────────────────────────────────────────
--  Postgres role setup for BNR Licensing Portal.
--
--  This script runs once when the Postgres container is first initialized
--  (via /docker-entrypoint-initdb.d). It creates the two roles our security
--  model depends on:
--
--    bnr_admin: used ONLY for migrations and seed scripts at deploy time.
--               Owns the schema, has full DDL+DML.
--    bnr_app:   used by the running application. Restricted permissions.
--               No UPDATE/DELETE on AuditLog (enforced by REVOKE in
--               the migration after tables exist).
--
--  Passwords here are dev-only. In production, set them via env vars
--  and rotate regularly.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE ROLE bnr_admin WITH LOGIN PASSWORD 'admin_pw_change_me' CREATEDB;
CREATE ROLE bnr_app   WITH LOGIN PASSWORD 'app_pw_change_me';

-- The default `postgres` superuser created the database (POSTGRES_DB).
-- Hand ownership to bnr_admin so it can run migrations.
ALTER DATABASE bnr_portal OWNER TO bnr_admin;

-- Both roles need to connect.
GRANT CONNECT ON DATABASE bnr_portal TO bnr_admin;
GRANT CONNECT ON DATABASE bnr_portal TO bnr_app;

-- Schema-level grants happen after migration creates tables.
-- See apps/api/prisma/migrations/<initial>/migration.sql for the
-- per-table GRANT/REVOKE statements that lock down AuditLog.
