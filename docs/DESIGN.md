# Design Document

This document captures the *why* behind the architecture. The README explains what the system is; this explains the alternatives considered and rejected, the tradeoffs accepted, and where to go next.

---

## Architecture

### Why a modular monolith

The domain is small and tightly coupled around a single transactional boundary. Approving an application must atomically: change the application state, append the audit record, and commit any related side-effects. A microservice split would force one of:

- **Distributed transactions** (XA, sagas) — operationally complex, error-prone, wrong fit for a regulator workflow where partial commits are unacceptable.
- **Eventual consistency** — equally wrong here. The audit log claiming an action that didn't happen, or vice versa, is a regulatory violation.

A monolith with disciplined module boundaries gets us testability and modularity without the operational tax. If the system needed to scale to thousands of concurrent users, the first extractions would be:

1. Document storage → S3 (or equivalent) with retention locks.
2. Notifications → outbox pattern + worker.
3. Audit log → cold-storage tier with read replicas for compliance queries.

The modular boundaries already drawn make these mechanical, not rewrites.

### Module boundaries

Each domain concern lives in its own NestJS module under `src/modules/`. Cross-cutting infrastructure (Prisma, error filter, logging) lives in `src/common/`.

Rules:
- Modules import other modules' **public service exports**, never their internals.
- The `audit` module is depended on by `auth` and `applications` (both write logs); the reverse is forbidden.
- The `applications/workflow/` subfolder is internal — no other module imports from it.

---

## Data model

Five tables: `User`, `Session`, `Application`, `Document`, `AuditLog`, plus `IdempotencyKey` for safe-retry creation endpoints.

### Why `version` on `Application`

Optimistic locking. Every transition is an `UPDATE ... WHERE id = ? AND version = ?` that increments the version. When two simultaneous transitions race, exactly one row is updated; the other is told the application changed under it (409). This is preferable to `SELECT FOR UPDATE` because:

- No DB locks held across HTTP requests.
- No deadlocks under contention.
- Pairs naturally with REST (no long-running transactions).

### Why `Document` rows are immutable

Spec calls for "never overwrite previous versions." We model this as append-only: each upload is a new `Document` row with an incremented `version` for its `(applicationId, documentType)` pair. The unique constraint on that triple is the DB's enforcement. No `updatedAt` column on this table — rows are frozen at creation.

### Why `AuditLog.actorEmail` and `actorRole` are captured at write time

Joining to `User` at read time would mean: if a user is renamed, every historical audit row "changes" what it claims. That's a tampering vector by accident. Snapshotting at write time gives us a frozen-in-time legal record that survives user changes.

`actorId` is nullable to support failed-login audits where no user is known.

---

## Auth & RBAC

### Threat model (selected)

| Threat | Mitigation |
|---|---|
| Database leak of password hashes | argon2id with OWASP 2024 parameters |
| XSS stealing tokens | httpOnly cookies — JS can't read them |
| CSRF | Double-submit CSRF token + SameSite=Strict cookie |
| Stolen token replay | 1-hour JWT + session-row revocation on logout/deactivation |
| Privilege escalation | Roles enforced server-side on every request |
| Email enumeration via login timing | Constant-time response (dummy hash for unknown emails) |
| Brute force | Per-IP rate limit on /auth/login |

### Reviewer ≠ Approver: three layers

This is the most important business rule in the spec.

1. **HTTP layer (`@Roles`)** — a user with role `REVIEWER` cannot reach the `/approve` endpoint at all.
2. **Service layer** — `WorkflowService` checks `app.reviewerId === user.id` before approving and throws 403.
3. **Database** — `CHECK ("reviewerId" IS NULL OR "approverId" IS NULL OR "reviewerId" <> "approverId")`. Even a SQL-injection bypass of the upper layers can't violate this.

### Cookies + CSRF, not bearer tokens

httpOnly cookies aren't readable by JavaScript, so XSS can't extract the auth token. The cost: cross-origin requests don't carry them by default, and the cookie auto-sends on every request, exposing CSRF as a concern. We close that with `SameSite=Strict` (browser refuses cross-site sends) and a double-submit CSRF token (server compares header to cookie). Two layers, one of which is a browser feature with no per-request cost.

The downside: a frontend on a different domain than the API needs cookie-domain configuration. For an internal portal this is fine.

---

## Concurrency

### Optimistic locking, not row locks

```sql
UPDATE "Application"
SET state = 'UNDER_REVIEW', version = version + 1, ...
WHERE id = ? AND version = ?
```

If two reviewers click "Start Review" simultaneously:

- Both load the page; both see `version = 1`.
- Both POST the action with `expectedVersion: 1`.
- One transaction commits first, version becomes 2.
- The other's `UPDATE` matches zero rows. Service throws `ConcurrentModificationError` → 409.

The frontend interprets 409 as "this changed under you," refetches, and shows the new state with appropriate available actions.

### Why not `SELECT FOR UPDATE`

Holds a row lock for the entire HTTP request. Deadlocks under cross-row contention. Doesn't compose with Prisma's transaction client cleanly. Optimistic locking is the right tool here because contention is naturally rare: two reviewers acting on the same application at the same millisecond is a bug-shaped event, not a steady-state.

### Atomicity with the audit log

State change and audit row are written in a single Prisma transaction:

```typescript
return this.prisma.$transaction(async (tx) => {
  const updated = await tx.application.updateMany({ where: { id, version }, data });
  if (updated.count === 0) throw new ConcurrentModificationError();
  await this.audit.recordWithTx(tx, { ... });
});
```

If the audit write fails for any reason, the state change rolls back. There is no scenario where the application transitions without an audit, or an audit refers to a transition that didn't commit. We test this explicitly (`workflow-atomicity.spec.ts` in the test plan).

---

## Audit

### Append-only at the database level

Two layers of immutability:

1. **Application discipline.** `AuditService` exposes only `record()` and `recordWithTx()`. No update or delete methods exist on the service surface.
2. **Database-level enforcement.** The runtime DB role (`bnr_app`) has `UPDATE`, `DELETE`, and `TRUNCATE` revoked on the `AuditLog` table. Migrations run as `bnr_admin` (which has full DDL); the running application connects as `bnr_app`.

This means even a SQL-injection vulnerability in the API cannot rewrite or delete audit history. The DB itself rejects the query before it runs. Verified by `audit-immutability.spec.ts`, which connects as `bnr_app` and asserts that raw `UPDATE`/`DELETE` against `AuditLog` returns "permission denied."

### What we don't protect against

- A compromised `bnr_admin` credential.
- A compromised host (filesystem-level attacker).
- A malicious DBA.

Defending against those threats requires WORM storage, hash-chained logs published externally, or external timestamping. We document them as future hardening, not as built features.

### Cursor pagination on audit reads

Audit logs grow forever. Offset pagination (`OFFSET 1000 LIMIT 50`) gets slower as offset grows because Postgres has to discard rows. Cursor pagination uses the row's id + ordering as a position marker — O(log n) regardless of depth, and stable under concurrent inserts.

---

## State machine

### As data, not code branches

The complete workflow is one flat list of `(action, fromState, toState, canAct)` rules. The pure functions `resolveTransition` and `availableActions` operate on this list with no I/O. They know nothing about Prisma, NestJS, HTTP, or the database.

This buys us:
- Trivially fast unit tests. Hundreds of cases run in milliseconds.
- A `/applications/:id/available-actions` endpoint that drives the UI button list directly. The frontend doesn't duplicate state-machine logic.
- A workflow change is a one-place change — add a row to the table.

### Why hand-coded, not xstate

xstate is excellent for hierarchical states, parallel regions, and visualizers. We have seven flat states and eight transitions. Adding a library is more code, not less. If the workflow ever grew sub-machines or guards-with-side-effects, xstate would earn its place.

---

## Idempotency

### Where it's used

- `POST /applications` — creating applications.
- `POST /applications/:id/documents` — uploading documents.

These are the endpoints where retries can produce duplicates that the optimistic-locking mechanism doesn't catch (because there's no existing row to lock against).

### Where it's not used

- Workflow transitions (`/submit`, `/approve`, etc.) — `expectedVersion` covers retries naturally. A retried action returns 409 because the version has moved; the frontend interprets that as "your action probably already worked, refetch."
- `/auth/login` — retries create extra session rows, which expire shortly. Tradeoff documented.
- All GET requests — idempotent by HTTP semantics.

### Implementation sketch

A small `IdempotencyKey` table (`key`, `userId`, `requestHash`, `status`, `responseBody`, `expiresAt`). An interceptor checks the header on relevant endpoints:

- Same key, same hash → replay the cached response. Don't re-execute.
- Same key, different hash → 409 `IDEMPOTENCY_KEY_REUSED`. Client bug, not a retry.
- New key → execute, store result with 24h TTL.

---

## API design

### URL conventions

- Resource-oriented for CRUD (`GET /applications`, `POST /applications`).
- **Action sub-paths for workflow transitions** (`POST /applications/:id/approve`). This violates "no verbs in URLs" deliberately because the alternative (`POST /applications/:id/state-transitions` with body `{action: 'APPROVE'}`) is awkward and reads worse.
- Single API version: `/api/v1`. Adding `/v2` later is fine; we'll keep v1 alive during transitions.

### Standard error envelope

Every error response shares this shape:

```json
{
  "error": {
    "code": "CONCURRENT_MODIFICATION",
    "message": "...",
    "requestId": "req_01H...",
    "details": { ... }
  }
}
```

`code` is the stable identifier the frontend switches on. `message` may change between releases; `code` is part of the contract.

The global exception filter catches *everything* (`@Catch()` no args), including unexpected runtime errors. Anything not specifically translated becomes an opaque 500 with `code: "INTERNAL_ERROR"` — never the original message, never a stack trace.

### 404 vs 403 policy

When a user tries to access a resource that exists but isn't theirs:
- If they shouldn't even know it exists (e.g., another applicant's application), return **404**.
- If they know it exists but the action isn't theirs (e.g., approver denied via reviewer-≠-approver check), return **403**.

This trades slight debugging difficulty for not leaking resource existence to unauthorized users.

---

## Frontend

### Why React Query, no global store

React Query already deduplicates concurrent fetches to the same key. A separate global state library would just duplicate its cache. The `useMe` hook wraps a `useQuery`; calling it from 5 components results in exactly 1 network request.

### Cache key conventions

A central `queryKeys` object means after a mutation we invalidate exactly what changed:

```typescript
qc.invalidateQueries({ queryKey: queryKeys.applications.detail(id) });
qc.invalidateQueries({ queryKey: queryKeys.applications.actions(id) });
qc.invalidateQueries({ queryKey: queryKeys.applications.audit(id) });
```

We don't `invalidateQueries({})` (everything). That would refetch documents and users for no reason.

### 409 handling UX

When a workflow action returns 409 `CONCURRENT_MODIFICATION`, we don't show a generic error. We refetch the application detail and available actions, then display a yellow banner explaining what happened. The user sees the page they should've seen, with context — not a stack trace.

---

## Testing

### Three tiers, deliberate scope

- **Unit (`test/unit/`)** — pure functions only. No I/O. Sub-second. The state machine lives here.
- **Integration (`test/integration/`)** — real Postgres, real services. Truncation between tests. ~60s for the suite.
- **E2E (`test/e2e/`)** — one happy-path test through HTTP. Smoke test, not primary coverage.

### Tests worth highlighting

- `workflow-concurrency.spec.ts` — fires two parallel `Promise.allSettled` transitions on the same application, asserts exactly one succeeds and exactly one audit row is written.
- `audit-immutability.spec.ts` — connects as `bnr_app` and issues raw `UPDATE`/`DELETE` against `AuditLog`, asserts permission denied. Proves the regulatory immutability claim at the database level, not just the service.
- `reviewer-not-approver.spec.ts` — a user who reviewed an application and is later granted APPROVER role still cannot approve their own review. All three layers (HTTP, service, DB) tested.

### Why coverage isn't a goal

A test that asserts "the controller calls the service" is theater. A test that asserts "two simultaneous approve calls produce exactly one APPROVED row" is engineering. We aim for the latter. Coverage will likely land at 70-80% on the backend incidentally; that's fine and not a metric we optimize.

---

## Operations

### Two Postgres roles by design

- **`bnr_admin`** — used only for migrations and seeding at deploy time. Owns the schema. Full DDL/DML.
- **`bnr_app`** — used by the running application. Restricted: SELECT/INSERT on `AuditLog`, full DML elsewhere.

`docker-compose.yml` and the CI workflow connect with `bnr_app` for the application/test process and `bnr_admin` for migrations. This split is what makes the audit-log-immutability tests *meaningful* — the test connection is the same role the production app uses.

### Local development

```bash
docker compose up -d db    # postgres only
npm run dev:api            # NestJS with hot reload
npm run dev:web            # Next.js with hot reload
```

For a production-like environment: `docker compose up` brings up everything.

---

## Tradeoffs and limitations

| Decision | Tradeoff | When to revisit |
|---|---|---|
| 1-hour JWT, no refresh | Users re-login when expired | If UX complaints, add rotating refresh tokens |
| Per-IP login rate limit | Doesn't stop distributed brute force | Add per-account backoff (with DoS-protection considerations) |
| HS256 signing | Single key compromised = total compromise | If splitting into multiple services |
| In-memory rate limit | Doesn't share across replicas | Switch to Redis-backed throttler when scaling out |
| Role embedded in JWT | Stale role until token expires | If immediate role-change propagation becomes critical |
| No MFA | Single-factor auth | Production banking requires MFA — out of scope |
| Local file storage | No durability beyond container disk | Swap to S3 via `StorageService` interface (already abstracted) |
| Lazy idempotency-key cleanup | Table grows without scheduled cleanup | Add a cron job in production |
| Coverage not optimized | Some glue code untested | Add tests if they expose specific risks |

---

## Where we'd go next

In rough priority order:

1. **Hash-chained audit log.** Each row hashes the previous row's hash. Tampering breaks the chain. Strong tamper-evidence beyond REVOKE.
2. **Notification system.** Outbox pattern + worker. Reviewers get pinged when applications enter their queue.
3. **Document virus scanning.** ClamAV or equivalent before storage write.
4. **Per-account login lockout** with exponential backoff and admin-unblock UI.
5. **Read replicas for compliance queries.** Audit log dominates read load; offload it.
6. **Comprehensive frontend test coverage.** Currently undertested by design.
7. **MFA via TOTP**, then potentially WebAuthn/passkeys.
8. **Document inline preview** (PDF.js).
9. **i18n** (French and Kinyarwanda for BNR).
10. **Audit log retention/archival policy** and corresponding API.
