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

Local ledger records live beside `CONTRACTOR_AI_DATA_DIR` and are intentionally ignored by Git. A pre-ledger `STATE_FILE` is read only once when the ledger is empty, then remains an optional migration source and is never written by the application. Use the Operations screen to retain the owner-controlled business identity used on quote packages, inspect and filter the chained audit history, create, verify, and download a backup, export an operator-readable ledger snapshot, inspect archived jobs, request a controlled restore, and archive eligible QA/demo jobs, non-won opportunities, workers, and tools. Backups are created before a QA reset. Move downloaded packages to encrypted off-device storage so a disk or host failure cannot remove both the live ledger and its recovery copy.

To restore a verified SQLite backup, stop the local Contractor.AI process first, then run:

```powershell
tar -xzf contractor-ai-backup-<backup-id>.tar.gz -C ./data/backups
npm run restore:local -- --backup-id <backup-id> --confirm RESTORE_<backup-id>
```

The download endpoint streams a private `tar.gz` package only after verifying every manifest entry. Extracting it into `data/backups` recreates the `<backup-id>` directory expected by the stopped-runtime restore command. Backup manifest v2 includes the SQLite ledger and every completed private evidence file under `UPLOAD_DIR`; duplicate paths, temporary writes, symlinks, unsafe paths, missing files, and checksum changes fail verification. Before replacing live data, the restore command verifies SQLite integrity and the canonical ledger tables, then saves the current ledger and evidence as a `pre-restore-*` package. Restored browser sessions are revoked so an older cookie cannot be resurrected, and a process restart remains required. Manifest v1 remains supported for older database-only backups but does not replace evidence. Hosted PostgreSQL recovery remains a managed provider procedure.

## Safety Model

- The ledger is the source of truth for jobs, work, approvals and audit evidence.
- Audit evidence is append-chained with SHA-256 inside the same database transaction as each retained business change. Sequence gaps, payload rewrites, deleted events, and a stale chain head make diagnostics and readiness fail; owners can run a fresh verification through `/api/operations/audit-integrity`.
- Autonomous cycles create internal drafts, reminders and approval records only.
- Contractor.AI never sends a message, confirms a date, commits supplier spend, invoices, or makes payment claims without a verified integration and a resolved approval.
- Mandatory lifecycle and procurement gates cannot be disabled by a request payload. Rejected or cancelled approvals restore the prior retained state so the operator can revise and resubmit without leaving a deadlocked `pending_approval` record.
- Estimate and change-order totals are calculated from validated retained line items on the server. Intake without a positive estimate or explicit line items does not invent a zero-value quote. Internal approval permits review or issue preparation but does not establish client acceptance or alter contract value. An approved quote can produce one immutable, checksum-protected HTML issue package and one separate outbound communication draft; package preparation neither sends the draft nor changes the contract. Quote and scope-change acceptance require a separate dated evidence reference and approver verification; contract value is retained net of VAT from the accepted quote baseline plus accepted change orders.
- Procurement and purchase approvals require an active retained trade partner with current registration, VAT or verified exemption, verification evidence, and any required insurance or VCA expiry evidence. Compliance is re-checked transactionally when the approval is resolved; a failed check leaves the approval pending.
- Crew records are retained people resources, not payroll or messaging accounts. Direct retirement and edits to retired records are blocked. Operational assignments block retirement; assignments retained on inactive or archived jobs are reported separately and released inside the approved retirement transaction so restoring a job cannot reactivate a retired worker.
- An approved outbound communication can only be marked delivered through `/api/ledger/communications/:id/delivery-receipt` with an allowlisted `CONTRACTOR_AI_VERIFIED_INTEGRATIONS` provider identifier; the receipt is retained in the audit trail.
- Invoice issue is split into draft approval, immutable package preparation, delivery approval, and verified delivery receipt. HTML and UBL attachments are regenerated from their retained snapshot and checksum-verified before download, delivery approval, and receipt recording. UBL export preparation is not a certification or network-submission claim; provider transport remains disabled until explicitly configured.
- Issued invoices are corrected through approval-gated credit notes instead of editing retained invoice evidence. A draft reserves its exact gross amount against concurrent payment or credit requests; approval permits package preparation, and only a numbered immutable HTML/UBL CreditNote package adjusts the receivable. The correction retains the original invoice number and issue date, uses the source VAT rate, and requires a separately approved verified delivery receipt.
- Supplier invoices retain the original supplier reference, VAT split, due date, purchase-order and delivery links, and a duplicate-resistant supplier/reference key. Approval requires a three-way match or an explicit exception reason. Supplier payment records require a separate approval, reject duplicate references and overpayment, and retain external bank evidence only; Contractor.AI never initiates or claims to initiate a transfer.
- Billing milestones retain the staged net value, VAT rate, planned issue date, payment date, and approval decision. Active milestones cannot exceed the job's retained contract value. An approved milestone can source exactly one invoice at the retained values; rejecting that invoice releases the milestone for correction without losing its history.
- The durable autonomous scheduler is opt-in. It uses an atomic compare-and-swap database lease so concurrent hosted replicas cannot claim the same due cycle. It only creates ledger drafts, checks, reminders, and approval records; external commitments remain blocked.
- Owners can inspect the prioritized command plan in Operations and apply exact safe-draft action IDs. Office operators can review the queue but cannot apply command-plan automation or request a scheduler run.
- Manual dashboard and direct API cycles use the same persisted scheduler lease as background execution. Invalid candidates, such as a budget draft without a positive estimate or contract value, are retained as blocked results without aborting other safe work.
- Evidence uploads accept JPEG, PNG, WebP, PDF and DOCX only, validate MIME, filename and binary signature, enforce bounded request sizes, and are never exposed as a public static directory.
- Field evidence retries carry a stable `Idempotency-Key`. Every processing attempt owns a unique durable lease, so an expired uploader cannot complete or release its replacement's receipt. Completed responses are retained in the ledger for 24 hours, exact retries replay without storing another object, and changed payloads using the same key are rejected.
- Daily site logs retain the field report, scoped worker time card, and safety state in one transaction. A stable entry key makes an exact retry replay-safe and rejects changed content; any child-record failure rolls back the report, approval, time, safety, and audit writes together.
- Job tasks are retained operational records with open, in-progress, blocked, completed, and cancelled states. Completion, blocking, and cancellation require outcome evidence. Field workers can start, block, or complete only unassigned tasks or tasks assigned to their scoped worker identity; responses remain field-projected and cannot expose finance, client contact, approval, or audit internals.
- Active tasks retain elapsed-hour duration and finish-to-start dependencies. The directed graph rejects cycles and calculates earliest/latest dates, total float, critical tasks, and a 14-day look-ahead. An internal schedule baseline is an immutable checksummed snapshot behind owner approval; task or dependency changes make the approved baseline visibly stale. This baseline never commits a date to a client or crew, which remains a separate schedule-commitment approval.
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

The supported surface is `/api/ledger/*`, including opportunities, intake, jobs, approvals, dispatch, workforce, field assurance, finance, client success and autonomous cycles. Operational maintenance endpoints are:

- `GET /api/session` returns the current role and capability boundary without exposing token material. `POST /api/auth/login` exchanges a configured role key for a revocable HTTP-only browser session; `POST /api/auth/logout` revokes it in the ledger and clears the cookie.
- `GET /api/ledger/opportunities` returns the retained preconstruction pipeline and weighted forecast. Owner and office operators can `POST /api/ledger/opportunities`, `PATCH /api/ledger/opportunities/:id`, retain or complete internal activities under `/activities`, and idempotently `POST /api/ledger/opportunities/:id/convert`. Conversion creates one linked job without assigning crew or making an external commitment. A linked opportunity becomes `won` only when a separate quote-acceptance approval verifies dated client evidence; a manual win is rejected and a loss requires a retained reason. Approvers have read-only pipeline access and field workers have none.
- `GET /api/ledger/command-plan` previews prioritized ledger work; owner-only `POST /api/ledger/command-plan` applies selected safe action IDs without external commitment.
- Owner-only `POST /api/ledger/autonomous-cycle` preserves dry-run inspection while routing every bounded mutating request through the durable scheduler lease; callers can scope work with `actionTypes`, `jobIds`, and `maxActions`.
- Overdue open opportunities enter the command queue as `draft_opportunity_follow_up`. An autonomous cycle can retain one idempotent internal follow-up draft per opportunity/due timestamp, but cannot send it or create any external commitment.
- `GET /api/ledger/scheduler` exposes the durable lease and last outcome; owner-only `POST /api/ledger/scheduler/run` claims and completes a due cycle idempotently.
- `POST /api/ledger/weather/assess`
- `POST /api/ledger/schedule/recommend`
- `POST /api/ledger/schedule/prepare-dispatch`
- `POST /api/ledger/schedule/request-approval`
- `POST /api/ledger/jobs/:id/field-assurance-pack`
- `POST /api/ledger/jobs/:id/progress` records an atomic progress and job-state update. Optional `entryKey` retries return the original update and reject changed content.
- `POST /api/ledger/jobs/:id/tasks` creates a retained internal work item and can atomically link an optional predecessor. `PATCH /api/ledger/jobs/:id/tasks/:taskId/schedule` updates internal duration or planned dates without creating an external commitment. `PATCH /api/ledger/jobs/:id/lifecycle/task/:recordId` starts, blocks, completes, reopens, or cancels it with an audited transition; completion, blocking, and cancellation require retained outcome evidence.
- `POST /api/ledger/jobs/:id/task-dependencies` retains a finish-to-start link after same-job and cycle validation; `POST /api/ledger/jobs/:id/task-dependencies/:dependencyId/cancel` removes it from the current graph while preserving history. `POST /api/ledger/jobs/:id/work-plan/calculate` returns the current critical-path and look-ahead calculation. `POST /api/ledger/jobs/:id/schedule-baselines` freezes that exact plan behind an `internal_schedule_baseline` approval; stale or checksum-invalid snapshots cannot be approved.
- `GET /api/ledger/organization` reports retained business identity and commercial-issue readiness. Owner-only `PUT /api/ledger/organization` updates legal, contact, registration, VAT, electronic-address, postal, banking, and default commercial terms.
- `POST /api/ledger/jobs/:id/quote` retains a server-calculated estimate with up to 50 validated line items and creates its internal issue approval. `POST /api/ledger/jobs/:id/quotes/:quoteId/issue-package` requires that approval plus a complete business identity, then idempotently retains an immutable package and approval-gated delivery draft. Authenticated `GET /api/ledger/documents/:id/issue-package` verifies the checksum before returning the print-ready attachment. `POST /api/ledger/jobs/:id/quotes/:quoteId/acceptance` requires an approved quote plus dated client evidence and creates a separate acceptance-verification approval; only resolution establishes the accepted net contract baseline.
- `POST /api/ledger/jobs/:id/invoices` derives VAT and gross totals from the retained net amount and rate, rejects caller mismatches, and creates an internal issue approval. `POST /api/ledger/jobs/:id/invoices/:invoiceId/issue-package` allocates a durable yearly invoice number and idempotently retains a checksum-protected HTML invoice plus an optional Peppol BIS Billing 3.0-oriented UBL 2.1 export when its seller, buyer, reference, address, endpoint, VAT, line, and payment readiness checks pass. Package preparation creates a separate delivery approval and does not submit to Peppol. The invoice becomes a receivable only after an allowlisted delivery receipt.
- `POST /api/ledger/jobs/:id/billing-milestones` retains a contract-bounded staged billing record and creates a `billing_schedule` approval. Approval makes the milestone available to one invoice draft; the invoice amount, VAT, currency, description, and due date are then derived from the milestone and cannot be overridden. Autonomous cycles create only the internal milestone first and wait for approval before drafting its invoice.
- `POST /api/ledger/jobs/:id/invoices/:invoiceId/credit-notes` retains a server-calculated net, VAT, and gross correction against an immutable issued invoice. It requires a reason, exact currency and source VAT rate, reserves the available receivable balance immediately, and creates an internal issue approval without changing the invoice total. `POST /api/ledger/jobs/:id/credit-notes/:creditNoteId/issue-package` requires that approval, rechecks concurrent reservations, allocates a durable yearly `CRN` number, and idempotently retains checksum-protected HTML plus optional Peppol BIS Billing 3.0-oriented UBL CreditNote evidence that references the original invoice. Package preparation adjusts the receivable; delivery remains a separate approval and verified-integration step.
- `GET /api/ledger/jobs/:id/handover-readiness` reports the exact completion, contractor identity, client, field evidence, quality, safety, permit, inspection, incident, observation, and punch requirements for a Wkb-style handover dossier. `POST /api/ledger/jobs/:id/handover-packages` idempotently freezes the current evidence manifest, audit-chain head, evidence digest, package digest, and print-ready HTML behind a separate client-delivery approval. Authenticated `GET /api/ledger/documents/:id/issue-package` verifies both retained checksums before download. Evidence changes make an older package stale and block its approval or delivery. The dossier is evidence-oriented and does not claim statutory Wkb certification.
- `POST /api/ledger/jobs/:id/invoices/:invoiceId/payments` retains a received-payment or write-off request against one exact invoice after its immutable issue package exists. The ledger reserves pending amounts, rejects ambiguous invoice matching, currency mismatches, overpayments, and normalized duplicate references, and leaves the invoice unchanged until approval. Approval atomically records the payment evidence and moves the invoice to `partially_paid`, `paid`, or `settled`; rejection restores an existing collection record without consuming the reference or balance. This is reconciliation evidence only and never moves funds.
- `POST /api/ledger/jobs/:id/supplier-invoices` retains an accounts-payable invoice behind approval, checks purchase-order, supplier, currency, net amount, delivery evidence, and partner compliance, and requires an explicit override reason for exceptions. `POST /api/ledger/jobs/:id/supplier-invoices/:supplierInvoiceId/payments` retains approval-gated external payment evidence, blocks duplicate references and overpayment, and reconciles partial or final settlement without moving funds.
- `POST /api/ledger/jobs/:id/change-orders` retains a server-calculated scope, price, VAT, and schedule delta behind internal approval. `POST /api/ledger/jobs/:id/change-orders/:changeOrderId/acceptance` separately verifies client evidence; only resolution adds the accepted net change to contract value.
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
- `POST /api/ledger/jobs/:id/invoices/:invoiceId/payments`
- `POST /api/ledger/jobs/:id/payments/follow-up`
- `POST /api/ledger/jobs/:id/payments/:paymentId/follow-up`
- `POST /api/ledger/jobs/:id/finance-handoffs/prepare`
- `POST /api/ledger/communications/:id/delivery-receipt`

- `GET /api/operations/export` downloads a SHA-256 protected v2 reconciliation artifact, including schedule baselines, task dependencies, billing milestones, supplier invoices, and retained supplier-payment evidence. It is human-readable and explicitly non-restorable.
- `POST /api/operations/exports/validate` verifies the v2 export structure and checksum.
- `POST /api/operations/backup`
- `GET /api/operations/backups`
- `GET /api/operations/backups/:backupId/verify`
- Owner-only `GET /api/operations/backups/:backupId/download` streams the verified SQLite and evidence package as `tar.gz`.
- `POST /api/operations/restore/validate` with `{ "backupId": "..." }` verifies the retained backup checksums and SQLite restore readiness. Summary exports are rejected.
- `GET /api/operations/audit-integrity` verifies the complete retained audit chain against its atomic head and returns `503` when any event or sequence no longer matches.
- Owner-only `GET /api/ledger/audit` returns newest-first, sequence-cursor pages of retained audit events with chain hashes. Use `beforeSequence` for the next page; exact `jobId`, `entityType`, `entityId`, `action`, and `actor` filters, `from` and `until` date bounds, free-text `query`, and `includeFacets=true` support investigation without loading the full ledger.
- `GET /api/operations/capabilities`
- `POST /api/operations/reset-qa` with `{ "confirmation": "RESET_QA" }` creates a verified local backup before archiving eligible QA/demo jobs and non-won opportunities and retiring matching workers and tools. Verified wins remain immutable.
- `GET /api/readiness`
- `GET /api/health/ready` exposes only a minimal orchestration status; hosted startup and readiness require a successful bounded object-storage PUT/GET/DELETE check inside the configured private prefix.

Evidence content is retrieved through `GET /api/ledger/documents/:id/content`, which requires normal dashboard/API authentication and records the access in the ledger audit trail.

`POST /api/ledger/upload` accepts an `Idempotency-Key` header containing 8 to 200 letters, digits, dots, underscores, colons, or hyphens. Clients should reuse the same key only when retrying the exact same evidence payload. Successful replays return `Idempotent-Replayed: true`. The former `/api/upload` route is a non-mutating `410` migration boundary.

`/api/jobs`, `/api/workers`, `/api/tools`, `/api/clients`, `/api/approvals`, `/api/audit`, `/api/communication`, `/api/weather`, `/api/schedule`, `/api/ai/chat`, and `/api/test/notifications` return explicit `410` migration responses. New work must use the ledger API.
