# Bank Licensing & Compliance Portal

An internal regulator portal for managing bank license applications through draft, review, and approval. Applicants submit license applications with documents; reviewers and approvers move them through a strict state machine; every action is recorded in an append-only audit log. Built as a NestJS modular monolith with PostgreSQL, a Next.js frontend, and a deliberately small set of dependencies.

> **Status: skeleton.** Architecture, schema, infrastructure, and the security-critical migration are in place. Feature modules (auth, applications, workflow, documents, audit) are designed in [`docs/DESIGN.md`](./docs/DESIGN.md) and will be implemented incrementally.

---

## Quick start

Requires Docker, Docker Compose, Node 20+, and npm 10+.

```bash
git clone <repo>
cd BLCP
cp .env.example .env

# Bring up Postgres in the background
docker compose up -d db

# Install workspaces and generate the Prisma client
npm install
npm run prisma:generate

# Apply migrations as the admin role (creates tables, then locks down the audit log)
DATABASE_URL="$DATABASE_ADMIN_URL" npm run prisma:migrate -- deploy --schema apps/api/prisma/schema.prisma

# Run the apps
npm run dev:api   # NestJS on :3000
npm run dev:web   # Next.js on :3001 (separate terminal)
```

URLs once running:
- Frontend: <http://localhost:3001>
- API: <http://localhost:3000/api/v1>
- Swagger: <http://localhost:3000/api/docs>
- Postgres: localhost:5432

---

## What's inside

**Domain.** A regulator (BNR) reviews bank license applications. Applicants submit applications with required documents; reviewers can request more information or pass to approvers; approvers issue final decisions. Every state change is permanently logged.

**Stack.**
- Backend: NestJS 11, PostgreSQL 16, Prisma 5, TypeScript
- Frontend: Next.js 16 (App Router), Tailwind 4, React Query 5
- Infra: Docker Compose, GitHub Actions

**Roles.**
- **Applicant** — creates applications, uploads documents, submits, resubmits after info request.
- **Reviewer** — picks up submitted applications, requests information, sends to approval.
- **Approver** — issues final approval or rejection (cannot be the same person who reviewed).
- **Admin** — manages users, observes the system, reads the audit log.

---

## How it works

### Workflow

```
   ┌─────────┐  submit   ┌───────────┐ start review  ┌──────────────┐
   │  DRAFT  │─────────► │ SUBMITTED │ ─────────────►│ UNDER_REVIEW │
   └─────────┘           └───────────┘               └──────┬───────┘
                                                            │
                            ┌───────────────────────────────┼──────────────┐
                            │                               │              │
                            │ request_info                  │ approve      │ reject
                            ▼                               ▼              ▼
                  ┌───────────────────┐                ┌──────────┐   ┌──────────┐
                  │ INFO_REQUESTED    │                │ APPROVED │   │ REJECTED │
                  └─────────┬─────────┘                └──────────┘   └──────────┘
                            │ resubmit                  (terminal)     (terminal)
                            ▼
                  ┌───────────────────┐
                  │   RESUBMITTED     │ ─── start review (loops back) ──► UNDER_REVIEW
                  └───────────────────┘
```

Every transition is defined as a row in a single transition table (`apps/api/src/modules/applications/workflow/transitions.ts`, to be added). Anything not in the table is rejected at the API boundary with a 409. APPROVED and REJECTED are terminal — no transition out.

### Key invariants enforced by the system

1. **Reviewer cannot also be the approver.** Enforced at three layers: the database (`reviewer_not_approver` CHECK constraint, see migration), the workflow service (ID comparison), and the role guard (HTTP 403).
2. **The audit log is append-only.** Enforced at the application layer (no update/delete API) and at the database layer: the `bnr_app` runtime role has `UPDATE`, `DELETE`, and `TRUNCATE` revoked on `AuditLog`.
3. **Concurrent transitions are safe.** Each application has a `version` counter; transitions use optimistic locking (`UPDATE ... WHERE version = ?`). Two simultaneous actions: one wins, one gets 409.
4. **State change and audit log commit atomically.** Always in the same transaction. Either both happen or neither.

---

## The decisions that matter

- **Modular monolith over microservices.** A single transactional boundary is non-negotiable for our audit guarantees. Splitting would force sagas. ([→ DESIGN.md#architecture](./docs/DESIGN.md#architecture))
- **Optimistic locking, not row locks.** `UPDATE ... WHERE version = ?` doesn't hold DB locks across HTTP requests, doesn't deadlock, and degrades gracefully under contention. ([→ DESIGN.md#concurrency](./docs/DESIGN.md#concurrency))
- **Audit log is append-only at the database level.** App services expose no update/delete API; the runtime DB role has UPDATE/DELETE revoked on the audit table. ([→ DESIGN.md#audit](./docs/DESIGN.md#audit))
- **Cookies + CSRF, not bearer tokens.** httpOnly cookies eliminate XSS token theft; double-submit CSRF + `SameSite=Strict` closes the matching attack vector. ([→ DESIGN.md#auth](./docs/DESIGN.md#auth))
- **State machine as data, not branching code.** A flat list of transition rules is the single source of truth for what's legal. The pure functions `resolveTransition` and `availableActions` know nothing about HTTP, Prisma, or NestJS — they're millisecond-fast unit tests.
- **Idempotency keys on creation endpoints.** `POST /applications` and `POST /applications/:id/documents` accept an optional `Idempotency-Key` header. Workflow transitions don't need it — optimistic locking covers retries.
- **No type sharing between frontend and backend.** Frontend defines its own types; the OpenAPI spec is the contract.

---

## Project structure

```
BLCP/
├── apps/
│   ├── api/              NestJS backend
│   │   ├── prisma/       schema.prisma + migrations (incl. lockdown)
│   │   ├── src/
│   │   │   ├── common/   PrismaModule, error filter, logging interceptor
│   │   │   ├── config/   typed env loading + Joi validation
│   │   │   ├── modules/  auth, users, applications/workflow, documents, audit
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   └── test/         unit, integration, e2e
│   └── web/              Next.js frontend
│       └── src/
│           ├── app/      App Router: (auth), (portal)
│           ├── components/
│           ├── hooks/
│           ├── lib/      api-client, query-client, query-keys
│           └── types/
├── docker/postgres/      init-roles.sql (creates bnr_admin and bnr_app)
├── docker-compose.yml
├── docs/                 DESIGN.md and supporting docs
└── .github/workflows/    CI
```

---

## Default credentials (after seeding)

The seed script (to be added) will create the following accounts. Password for all: `Passw0rd!ChangeMe`.

| Email | Role |
|---|---|
| `applicant1@bnr.seed` | APPLICANT |
| `applicant2@bnr.seed` | APPLICANT |
| `reviewer1@bnr.seed`  | REVIEWER  |
| `reviewer2@bnr.seed`  | REVIEWER  |
| `approver1@bnr.seed`  | APPROVER  |
| `approver2@bnr.seed`  | APPROVER  |
| `admin@bnr.seed`      | ADMIN     |

---

## What I deliberately didn't build

- **Email/SMS notifications.** Reviewers check the queue; no notification subsystem.
- **Real-time updates.** Refresh-driven, not WebSocket-driven.
- **Hash-chained audit log.** REVOKE is the immutability mechanism. Hash chaining is a documented future hardening.
- **Multi-factor authentication.** A real bank requires it; out of scope for this assessment.
- **Per-account login lockout.** Login is rate-limited per-IP only; per-account lockout has its own DoS tradeoffs.
- **i18n.** English only.
- **Refresh tokens.** 1-hour JWTs, no refresh — by design for a regulator portal.

---

## Further reading

- [`docs/DESIGN.md`](./docs/DESIGN.md) — architecture, tradeoffs, alternatives considered
- [`apps/api/prisma/schema.prisma`](./apps/api/prisma/schema.prisma) — data model with inline rationale
- [`apps/api/prisma/migrations/20260509000001_lockdown_audit_log/migration.sql`](./apps/api/prisma/migrations/20260509000001_lockdown_audit_log/migration.sql) — the security migration
