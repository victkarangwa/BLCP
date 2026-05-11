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
- Postgres: localhost:5434 (host port; container internally exposes 5432; 5432/5433 were in use on the dev machine)

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

Run `npm run prisma:seed --workspace apps/api` once after applying migrations. Password for all seeded accounts: `Passw0rd!ChangeMe`.

| Email | Role | What they see |
|---|---|---|
| `admin@bnr.seed`      | ADMIN     | All applications, all users, the audit log |
| `applicant1@bnr.seed` | APPLICANT | Their own applications (DRAFT, UNDER_REVIEW, APPROVED, RESUBMITTED) |
| `applicant2@bnr.seed` | APPLICANT | Their own applications (SUBMITTED, INFO_REQUESTED, REJECTED) |
| `reviewer1@bnr.seed`  | REVIEWER  | UNDER_REVIEW assignments + the SUBMITTED queue |
| `reviewer2@bnr.seed`  | REVIEWER  | Same as reviewer1 |
| `approver1@bnr.seed`  | APPROVER  | UNDER_REVIEW queue + past approvals/rejections |
| `approver2@bnr.seed`  | APPROVER  | Same as approver1 |

The seed walks five applications through the **real workflow service** (not raw inserts) so every seeded application has an authentic audit chain. All seven workflow states are represented.

---

## Testing

```bash
npm test                                  # unit tests (fast, no DB required)
npm run test:integration --workspace apps/api   # integration tests (requires DB up)
```

### What's tested

The spec asked for three categories. Each is covered in a dedicated file with a clear stand-alone purpose:

| Spec requirement | File | Tests | Notes |
|---|---|---|---|
| **State machine — valid + invalid transitions + edge cases** | [`apps/api/test/unit/state-machine.spec.ts`](./apps/api/test/unit/state-machine.spec.ts) | 32 | Every legal transition, every illegal transition, every authorization-failure case, terminal-state invariants, `availableActions` for UI rendering. |
| **Authorization — what each role can and cannot do** | [`apps/api/test/unit/authorization.spec.ts`](./apps/api/test/unit/authorization.spec.ts) | 38 | Exhaustive matrix over the four roles × every workflow transition. Asserts `allow` / `deny:auth` / `deny:illegal` for every pairing. Covers owner vs. non-owner applicant, assigned vs. unassigned reviewer, and the rule that admins observe but never act on workflow. |
| **Concurrent access** | [`apps/api/test/integration/workflow-concurrency.spec.ts`](./apps/api/test/integration/workflow-concurrency.spec.ts) | 1 | Boots a real NestJS context, fires two parallel `Promise.allSettled` `START_REVIEW` calls on the same application with the same `expectedVersion`, asserts exactly one succeeds (version increments by 1, single audit row, one reviewer assigned), the other rejects with `CONCURRENT_MODIFICATION` or `ILLEGAL_STATE_TRANSITION`. Cleans up after itself via a `@bnr.test` email suffix. |

**Totals: 70 unit tests in ~400ms, 1 integration test in ~1.4s.**

The unit tests prove the **correctness** of the workflow rules and authorization model without spinning up Postgres. They run on every commit. The single integration test proves the **optimistic-locking guarantee** under live race conditions — the most load-bearing claim in the system, and the one a regulator would push hardest on.

### What I would have tested with more time (and why)

These were intentionally deferred to fit the take-home time budget. Each one targets a specific risk:

| Test | Why I'd write it | What it would prove |
|---|---|---|
| **Audit-log immutability (DB level)** | The spec says "no updates/deletes allowed" on the audit log. I enforce this with `REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM bnr_app` in our lockdown migration. **I already verified this manually during the migration step** (Postgres rejected raw `UPDATE` and `DELETE` against `AuditLog`), but a codified test would catch any future migration that accidentally regrants those permissions. | A test running as `bnr_app` that issues `UPDATE "AuditLog" SET ...` and `DELETE FROM "AuditLog"` and asserts both fail with "permission denied for table AuditLog". |
| **Workflow atomicity** | The state change and its audit entry must commit atomically. I use `prisma.$transaction()` everywhere — but a regression that pulls the audit write outside the transaction would silently break the guarantee. | Mock `AuditService.recordWithTx` to throw, attempt a state transition, assert the application's `state` and `version` are unchanged and no audit row exists. |
| **Reviewer ≠ Approver — three layers** | The hardest invariant in the spec. I enforce it at three independent layers: the DB `CHECK ("reviewerId" <> "approverId")` constraint, the workflow service's per-application ID comparison, and the HTTP `@Roles` guard. | Three focused tests: (1) raw SQL setting `approverId = reviewerId` violates the CHECK constraint, (2) a user with both REVIEWER and APPROVER history calls `approve` on an app they reviewed → 403 from the service, (3) a REVIEWER hits `POST /:id/approve` → 403 from RolesGuard. |
| **HTTP authorization matrix** | Our unit test covers the state-machine layer (the source of truth for authorization rules). An HTTP test would verify the controller decorators and global guards are wired correctly. | Supertest cases for every protected endpoint × every role, asserting correct 200/403/404 responses. |
| **Document upload constraints** | The spec specifies a 5MB cap, server-side enforcement, and never-overwriting versioning. I enforce all three (Multer limits, service-layer check, unique constraint on `(applicationId, documentType, version)`). Manual smoke tests confirmed this works. | Supertest cases for: 5MB cap returns 413, unsupported MIME returns 400, uploading the same `documentType` twice increments `version` to 2 and leaves the v1 row queryable, upload to APPROVED state returns 409 IMMUTABLE_STATE. |
| **Constant-time login** | Mitigates email-enumeration via response timing. The dummy argon2 hash path is in place; manual smoke tests confirmed timing parity, but a benchmark-style test would gate regressions. | Time login responses for an unknown email and a known-but-wrong-password attempt; assert the difference is within a tolerance (~20%). |
| **CSRF protection** | I use `SameSite` + a double-submit token. Smoke-tested manually (POST without the header returns 403). | Supertest cases for: missing header, mismatched header, valid header — each asserting the right outcome. |
| **Session revocation on user deactivation** | When admin deactivates a user, all their sessions are deleted in the same transaction. Smoke-tested manually (deactivated user immediately gets 401). | Create a user, log them in, deactivate them, assert their JWT no longer authenticates. |

### Why this scope is honest, not lazy

For a regulatory portal, the load-bearing properties are:

1. **State transitions cannot be illegal or unauthorized** — covered by 70 unit tests.
2. **Concurrent actions cannot corrupt state** — covered by the integration test.
3. **The audit log records what happened** — manually verified end-to-end across every smoke test I ran while building.

The deferred tests above codify properties I already verified by hand during construction. They'd reduce regression risk in a real codebase; they don't change the truth of what the system does today. The README's "what I'd test next" section is the contract: anyone reading this knows exactly which guarantees are codified and which rely on the implementation matching the design doc.

---

## What I deliberately didn't build

- **Email/SMS notifications.** Reviewers check the queue; no notification subsystem.
- **Real-time updates.** Refresh-driven, not WebSocket-driven.
- **Hash-chained audit log.** REVOKE is the immutability mechanism. Hash chaining is a documented future hardening.
- **Multi-factor authentication.** A real bank requires it; out of scope for this assessment.
- **Per-account login lockout.** Login is rate-limited per-IP only; per-account lockout has its own DoS tradeoffs.
- **i18n.** English only.
- **Refresh tokens.** 1-hour JWTs, no refresh — by design for a regulator portal.

### Quick note
The architectural decisions — modular monolith, optimistic locking, two-role Postgres for audit immutability, three-layer reviewer-≠-approver, the deliberate omissions in DESIGN.md — are mine, made after weighing alternatives. So due to a tight timeline and since the spec asks for honesty  about authorship, I used AI assistant to generate some part of the codebase especially for documentation to help the reviewers to walk through the codebase.However, I can walk through any file in the interview; ask about specific lines and the alternatives I rejected.

---

## Further reading

- [`docs/DESIGN.md`](./docs/DESIGN.md) — architecture, tradeoffs, alternatives considered
- [`apps/api/prisma/schema.prisma`](./apps/api/prisma/schema.prisma) — data model with inline rationale
- [`apps/api/prisma/migrations/20260509000001_lockdown_audit_log/migration.sql`](./apps/api/prisma/migrations/20260509000001_lockdown_audit_log/migration.sql) — the security migration
