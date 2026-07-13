# Contractor.AI

Contractor.AI is a local-first operating system for Dutch and European contractor teams. It keeps jobs, approvals, dispatch, field evidence, finance handoffs and autonomous internal drafts in one persisted operating ledger.

The Node application is the sole product runtime. The dashboard is a React/Vite client that uses only the ledger API. Python prototypes, simulated dashboards and separate mock databases are retired.

## Local Use

Requirements: Node.js 22 and npm.

```powershell
Copy-Item .env.example .env # optional; use this when overriding local defaults
npm install
npm run build
npm start
```

Open `http://localhost:3000`. For development, start the API with `npm run dev:api` and the Vite client with `npm run dev`.

Local ledger records live beside `CONTRACTOR_AI_DATA_DIR` and are intentionally ignored by Git. A pre-ledger `STATE_FILE` is read only once when the ledger is empty, then remains an optional migration source and is never written by the application. Use the Operations screen to create, verify, and download a backup, export an operator-readable ledger snapshot, inspect archived jobs, request a controlled restore, and archive QA/demo records. Backups are created before a QA reset. Move downloaded packages to encrypted off-device storage so a disk or host failure cannot remove both the live ledger and its recovery copy.

To restore a verified SQLite backup, stop the local Contractor.AI process first, then run:

```powershell
tar -xzf contractor-ai-backup-<backup-id>.tar.gz -C ./data/backups
npm run restore:local -- --backup-id <backup-id> --confirm RESTORE_<backup-id>
```

The download endpoint streams a private `tar.gz` package only after verifying every manifest entry. Extracting it into `data/backups` recreates the `<backup-id>` directory expected by the stopped-runtime restore command. Backup manifest v2 includes the SQLite ledger and every completed private evidence file under `UPLOAD_DIR`; duplicate paths, temporary writes, symlinks, unsafe paths, missing files, and checksum changes fail verification. Before replacing live data, the restore command verifies SQLite integrity and the canonical ledger tables, then saves the current ledger and evidence as a `pre-restore-*` package. Restored browser sessions are revoked so an older cookie cannot be resurrected, and a process restart remains required. Manifest v1 remains supported for older database-only backups but does not replace evidence. Hosted PostgreSQL recovery remains a managed provider procedure.

## Safety Model

- The ledger is the source of truth for jobs, work, approvals and audit evidence.
- Autonomous cycles create internal drafts, reminders and approval records only.
- Contractor.AI never sends a message, confirms a date, commits supplier spend, invoices, or makes payment claims without a verified integration and a resolved approval.
- Mandatory lifecycle and procurement gates cannot be disabled by a request payload. Rejected or cancelled approvals restore the prior retained state so the operator can revise and resubmit without leaving a deadlocked `pending_approval` record.
- Procurement and purchase approvals require an active retained trade partner with current registration, VAT or verified exemption, verification evidence, and any required insurance or VCA expiry evidence. Compliance is re-checked transactionally when the approval is resolved; a failed check leaves the approval pending.
- Crew records are retained people resources, not payroll or messaging accounts. Direct retirement and edits to retired records are blocked. Operational assignments block retirement; assignments retained on inactive or archived jobs are reported separately and released inside the approved retirement transaction so restoring a job cannot reactivate a retired worker.
- An approved outbound communication can only be marked delivered through `/api/ledger/communications/:id/delivery-receipt` with an allowlisted `CONTRACTOR_AI_VERIFIED_INTEGRATIONS` provider identifier; the receipt is retained in the audit trail.
- The durable autonomous scheduler is opt-in. It uses an atomic compare-and-swap database lease so concurrent hosted replicas cannot claim the same due cycle. It only creates ledger drafts, checks, reminders, and approval records; external commitments remain blocked.
- Owners can inspect the prioritized command plan in Operations and apply exact safe-draft action IDs. Office operators can review the queue but cannot apply command-plan automation or request a scheduler run.
- Manual dashboard and direct API cycles use the same persisted scheduler lease as background execution. Invalid candidates, such as a budget draft without a positive estimate or contract value, are retained as blocked results without aborting other safe work.
- Evidence uploads accept JPEG, PNG, WebP, PDF and DOCX only, validate MIME, filename and binary signature, enforce bounded request sizes, and are never exposed as a public static directory.
- Field evidence retries carry a stable `Idempotency-Key`. Every processing attempt owns a unique durable lease, so an expired uploader cannot complete or release its replacement's receipt. Completed responses are retained in the ledger for 24 hours, exact retries replay without storing another object, and changed payloads using the same key are rejected.
- Daily site logs retain the field report, scoped worker time card, and safety state in one transaction. A stable entry key makes an exact retry replay-safe and rejects changed content; any child-record failure rolls back the report, approval, time, safety, and audit writes together.
- Job tasks are retained operational records with open, in-progress, blocked, completed, and cancelled states. Completion, blocking, and cancellation require outcome evidence. Field workers can start, block, or complete only unassigned tasks or tasks assigned to their scoped worker identity; responses remain field-projected and cannot expose finance, client contact, approval, or audit internals.
- Field evidence, progress updates, and daily site logs use a bounded IndexedDB outbox when connectivity fails. Drafts are bound to the current operator role and scoped worker, so another session cannot replay them; foreign-scope drafts remain quarantined. Scope-less drafts from the earlier local-only outbox are adopted only by the unauthenticated local owner. Progress entry keys are exact-replay safe, and progress, job-state, and audit writes commit or roll back together.
- Production requires an unpadded, non-template operator access token of at least 32 characters. The public application shell exchanges it through the throttled sign-in endpoint for a signed, short-lived, HTTP-only, SameSite session; the access key is never stored in browser storage. Failed sign-ins are counted by an HMAC-derived client key in the active SQLite or PostgreSQL ledger, so the limit survives restarts and coordinates hosted replicas without retaining the client address; successful authentication clears that client's failure window. General API quotas use atomic ledger counters in a bounded HMAC bucket space, preventing restarts, replica scaling, or address churn from bypassing the configured control or growing persistent state without limit. Browser sessions are retained by one-way id hash in the same ledger, so logout revokes the current cookie across restarts and hosted replicas. Cookie-authenticated mutations require an allowed same-origin `Origin` header, token rotation invalidates existing sessions, and bearer/API-key/Basic authentication remains available for controlled integrations. The React client portal remains token-scoped and cannot make a direct consequential commitment. Client messages are retained as inbound records, and selection responses become internal approval requests before the ledger records a confirmed choice or requested change. The portal uses the same external Vite assets and strict CSP as the operator application.
- Production can use `CONTRACTOR_AI_ROLE_TOKENS` for any number of named owner, approver, office operator, and field worker principals. Use `{"operators":[{"id":"office-utrecht","name":"Utrecht office","role":"office_operator","token":"..."}]}`; stable principal ids are retained in sessions, audit actors, upload retry ownership, and browser outbox isolation. The legacy role-keyed format remains supported. Every field-worker principal must be scoped with a ledger `workerId` or explicit `jobIds`; its readable job list, evidence retrieval, uploads, progress, daily reports, incident, safety, and time updates are limited to that scope. Field responses omit rates, estimates, contracts, margins, quotes, expenses, invoices, payments, client contacts and communications, portal access, approvals, and audit internals. Approvers resolve gates; only owners can run maintenance and governance actions.

## Verification

```powershell
npm run verify:release
npm run lint
npm run build
npm test
npm run test:browser
```

GitHub Actions runs the same checks for every push and pull request. Its PostgreSQL service enables TLS before testing, verifies `SHOW ssl`, and supplies `sslmode=require`, so hosted-path tests cannot silently fall back to a plaintext or skipped contract.

## Container and EU Hosting

The local-first Docker configuration persists data to a named volume:

```powershell
docker compose up --build
```

The local Compose stack starts without an `.env` file and persists its ledger and evidence in the `contractor-ai-data` volume. Add `.env` only when you need to override the local defaults.

Hosted operation is fail-closed until EU-region infrastructure is configured. It requires an HTTPS public origin, authentication, an explicit trusted ingress proxy address, durable EU object storage, a reachable managed PostgreSQL database, retained DPA/provider-region references, PostgreSQL backups, object versioning, and a recovery-policy reference. See [EU hosting guidance](docs/EU_HOSTING.md).

Evidence storage uses a private local filesystem in local mode and a signed S3-compatible adapter when configured for an EU host. Retained object references are restricted to the configured bucket and `CONTRACTOR_AI_S3_PREFIX`; sibling tenant prefixes and traversal-style references fail before an object request is signed. Readiness proves bounded PUT, GET, and DELETE access with a unique marker so health checks do not accumulate retained objects. Files remain available only through authenticated ledger retrieval. Hosted mode uses the same ledger contract through the PostgreSQL adapter and refuses startup if the target cannot be connected. PostgreSQL schema creation, migrations, and legacy seeding run under one advisory lock, so rolling deployments can start multiple replicas without applying a migration twice. Local migration and seeding checks execute inside SQLite write transactions.

To migrate a stopped, verified local backup into an empty hosted PostgreSQL database and private object store, configure the hosted environment variables and run:

```powershell
npm run migrate:hosted -- --backup-id <backup-id> --confirm MIGRATE_<backup-id>
```

The command accepts backup manifest v2 only, requires PostgreSQL TLS, refuses a non-empty target, migrates every ledger table in foreign-key order, uploads and reads back every evidence object, rewrites retained storage references, and records a checksummed migration receipt. Database and object changes are rolled back when pre-commit verification fails. The operational JSON export is an operator-readable validation artifact, not a complete hosted import format.

Hosted `POST /api/operations/backup`, local backup listing/download, and backup-first QA reset return `409 provider_recovery_required`. An application container cannot produce a complete backup of managed PostgreSQL plus private object storage. Use the declared provider recovery policy and retain its evidence outside Contractor.AI.

## Authoritative API

The supported surface is `/api/ledger/*`, including intake, jobs, approvals, dispatch, workforce, field assurance, finance, client success and autonomous cycles. Operational maintenance endpoints are:

- `GET /api/session` returns the current role and capability boundary without exposing token material. `POST /api/auth/login` exchanges a configured role key for a revocable HTTP-only browser session; `POST /api/auth/logout` revokes it in the ledger and clears the cookie.
- `GET /api/ledger/command-plan` previews prioritized ledger work; owner-only `POST /api/ledger/command-plan` applies selected safe action IDs without external commitment.
- Owner-only `POST /api/ledger/autonomous-cycle` preserves dry-run inspection while routing every bounded mutating request through the durable scheduler lease; callers can scope work with `actionTypes`, `jobIds`, and `maxActions`.
- `GET /api/ledger/scheduler` exposes the durable lease and last outcome; owner-only `POST /api/ledger/scheduler/run` claims and completes a due cycle idempotently.
- `POST /api/ledger/weather/assess`
- `POST /api/ledger/schedule/recommend`
- `POST /api/ledger/schedule/prepare-dispatch`
- `POST /api/ledger/schedule/request-approval`
- `POST /api/ledger/jobs/:id/field-assurance-pack`
- `POST /api/ledger/jobs/:id/progress` records an atomic progress and job-state update. Optional `entryKey` retries return the original update and reject changed content.
- `POST /api/ledger/jobs/:id/tasks` creates a retained internal work item. `PATCH /api/ledger/jobs/:id/lifecycle/task/:recordId` starts, blocks, completes, reopens, or cancels it with an audited transition; completion, blocking, and cancellation require retained outcome evidence.
- `POST /api/ledger/jobs/:id/daily-logs` atomically records one approval-gated field report, server-bound worker time card, and daily safety check. `entryKey` retries are replay-safe and changed content is rejected.
- `POST /api/ledger/jobs/:id/worker-instructions` retains a draft against the current `assignmentId` and `workerId`; `PATCH /api/ledger/jobs/:id/lifecycle/worker_instruction/:recordId` requires review evidence and approval before publication can satisfy dispatch readiness.
- `POST /api/ledger/jobs/:id/orientations` retains assignment-scoped induction evidence; `PATCH /api/ledger/jobs/:id/lifecycle/orientation/:recordId` requires a verification reference and approval before the orientation can support access.
- `POST /api/ledger/jobs/:id/site-access` requires an orientation for the same assignment and worker; `PATCH /api/ledger/jobs/:id/lifecycle/site_access/:recordId` keeps access blocked until explicit clearance approval.
- `POST /api/ledger/jobs/:id/assignments/:assignmentId/release` atomically releases the assignment, cancels its instructions, expires its orientations, checks out its access records, and rejects unresolved crew-evidence approvals. Those records remain visible as historical evidence but cannot satisfy replacement-crew readiness.
- `POST /api/ledger/jobs/:id/time-logs`
- `PATCH /api/ledger/jobs/:id/materials/:materialId/status`
- `POST /api/ledger/jobs/:id/procurement-orders/:orderId/request-approval`
- `GET /api/ledger/workers` lists retained crew records with availability, operational `activeAssignmentCount`, inactive-job `dormantAssignmentCount`, total `retainedAssignmentCount`, pending-retirement visibility, and a directory summary; `GET /api/ledger/workers/:id` returns one canonical record.
- `POST /api/ledger/workers` and `PUT /api/ledger/workers/:id` retain validated identity, contact, role, region, skill, availability, and internal cost evidence without creating a schedule, payroll, or communication action.
- `POST /api/ledger/workers/:id/retirement` creates a replay-safe approval and blocks new assignments while pending. Resolution refuses retirement while operational assignments remain and releases dormant inactive-job assignments in the same audited transaction before marking the worker retired.
- `GET /api/ledger/tools` lists retained equipment with condition, location, operational and dormant reservation counts, pending-retirement visibility, and a directory summary.
- `POST /api/ledger/tools` and `PUT /api/ledger/tools/:id` retain validated equipment identity, status, location, inspection, and internal reference evidence without creating a reservation, dispatch, purchase, or assignment.
- `POST /api/ledger/tools/:id/inspections` appends internal inspection evidence, derives current/due-soon/overdue/failed readiness, and never claims statutory certification. Equipment explicitly requiring inspection cannot be reserved while evidence is missing, overdue, failed, limited, or awaiting post-maintenance reinspection.
- `POST /api/ledger/tools/:id/maintenance` appends cost-free internal maintenance evidence without creating supplier spend or an external service commitment. Completed corrective work linked to a failed or limited inspection still requires a passing reinspection before reservation readiness is restored.
- `GET /api/ledger/dispatch` revalidates active crew assignments, assignment-scoped instruction/orientation/access evidence, and equipment reservations against current canonical records. Released-worker evidence cannot clear a replacement worker. Missing, retiring, unavailable, conflicting, or uncleared crew and unsafe equipment block dispatch immediately; busy or traveling crew remain visible as warnings for operator confirmation.
- `POST /api/ledger/tools/:id/retirement` creates a replay-safe approval and blocks new reservations while pending. Resolution refuses retirement while operational reservations remain and atomically releases dormant inactive-job reservations before marking the equipment retired. Owner-only `DELETE` remains a compatibility alias for the same non-destructive workflow.
- `GET /api/ledger/trade-partners` lists retained suppliers and subcontractors with derived compliance status and expiry warnings.
- `POST /api/ledger/trade-partners` and `PUT /api/ledger/trade-partners/:id` retain identity, registration, tax, insurance, VCA, specialty, and verification evidence.
- `POST /api/ledger/trade-partners/:id/retirement` creates a replay-safe approval. Approval blocks new purchasing selection while preserving all partner, procurement, finance, and audit history.
- `POST /api/ledger/jobs/:id/archive` creates a replay-safe `job_archive` approval only after existing job approvals are resolved. Approval removes the job from active workflows, makes it read-only, and revokes active client portal links without deleting any linked record or triggering an external action.
- `POST /api/ledger/jobs/:id/restore` creates a replay-safe `job_restore` approval for an archived job. Approval restores the exact retained status and phase while preserving archive history; portal links remain revoked and require a new approval. Operational writes return `409 job_inactive_read_only` until restore, while assignment/tool release and portal revocation remain available as audited commitment-reduction actions.
- `PATCH /api/ledger/jobs/:id/lifecycle/selection/:recordId` for approval-gated client decisions
- `GET /api/client-portal/:token` returns the restricted project view; `POST /api/client-portal/:token/messages` records an inbound client request.
- `POST /api/client-portal/:token/selections/:selectionId/responses` validates a published option or change request, deduplicates a pending response, and creates an internal `client_selection_response` approval. Approval records the client decision but cannot change price, scope, schedule, safety state, or procurement commitments.
- `PATCH /api/ledger/jobs/:id/lifecycle/document/:recordId` for controlled document review
- Dispatch controls surface retained procurement orders, material requirements, site orientations, safety records, RFIs, permits, documents, submittals, and client selections directly in the Dispatch workspace. Procurement approval creates no supplier order or spend commitment; consequential actions remain approval-gated.
- `POST /api/ledger/jobs/:id/finance-costs`
- `POST /api/ledger/jobs/:id/payments/follow-up`
- `POST /api/ledger/jobs/:id/payments/:paymentId/follow-up`
- `POST /api/ledger/jobs/:id/finance-handoffs/prepare`
- `POST /api/ledger/communications/:id/delivery-receipt`

- `GET /api/operations/export` downloads a SHA-256 protected v2 reconciliation artifact. It is human-readable and explicitly non-restorable.
- `POST /api/operations/exports/validate` verifies the v2 export structure and checksum.
- `POST /api/operations/backup`
- `GET /api/operations/backups`
- `GET /api/operations/backups/:backupId/verify`
- Owner-only `GET /api/operations/backups/:backupId/download` streams the verified SQLite and evidence package as `tar.gz`.
- `POST /api/operations/restore/validate` with `{ "backupId": "..." }` verifies the retained backup checksums and SQLite restore readiness. Summary exports are rejected.
- `GET /api/operations/capabilities`
- `POST /api/operations/reset-qa` with `{ "confirmation": "RESET_QA" }`
- `GET /api/readiness`
- `GET /api/health/ready` exposes only a minimal orchestration status; hosted startup and readiness require a successful bounded object-storage PUT/GET/DELETE check inside the configured private prefix.

Evidence content is retrieved through `GET /api/ledger/documents/:id/content`, which requires normal dashboard/API authentication and records the access in the ledger audit trail.

`POST /api/ledger/upload` accepts an `Idempotency-Key` header containing 8 to 200 letters, digits, dots, underscores, colons, or hyphens. Clients should reuse the same key only when retrying the exact same evidence payload. Successful replays return `Idempotent-Replayed: true`. The former `/api/upload` route is a non-mutating `410` migration boundary.

`/api/jobs`, `/api/workers`, `/api/tools`, `/api/clients`, `/api/approvals`, `/api/audit`, `/api/communication`, `/api/weather`, `/api/schedule`, `/api/ai/chat`, and `/api/test/notifications` return explicit `410` migration responses. New work must use the ledger API.
