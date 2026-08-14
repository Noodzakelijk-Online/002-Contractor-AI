# API Usage Audit

Audit date: 2026-08-13

The source declares 381 Express routes. The primary React dashboard has 86 unique
literal API path prefixes plus dynamic and child-component calls. Route presence alone is not considered
evidence of usability; release evidence combines route contract tests, UI action
mapping, browser flows, and the release-contract scan.

## Authoritative surfaces

| Surface | Purpose | Access |
| --- | --- | --- |
| `/api/auth/*`, `/api/session`, `/api/preferences` | Browser sessions and self-scoped locale preference | public login; authenticated session actions |
| `/api/ledger/*` | Canonical operational and business records | role and resource scoped |
| `/api/client-portal/:token/*` | Narrow client evidence and responses | scoped opaque portal token |
| `/api/operations/*` | backup, export, identity, audit, safety, diagnostics | owner/approver according to route |
| `/api/health/ready` | Minimal liveness/readiness probe | public, deliberately low detail |
| `/api/readiness` | Detailed runtime and provider readiness | authenticated |

Legacy simulation and non-ledger facades are not live. Routes that must remain
during a compatibility transition return an explicit `410 Gone` with migration
guidance. The production service serves the built Vite client for non-API routes.

## UI-to-API action map

| UI area | Contract families exercised |
| --- | --- |
| Today | dashboard, command plan, scheduler, organization, capabilities |
| Leads | opportunities, activities, market fit, bid decisions, site surveys |
| Jobs | lifecycle, tasks, schedule, risk, commercial scope, variations, handover |
| Planning | crew/workforce, assignments, Last Planner, daily cycles, constraints |
| Field | attendance, daily logs, LMRA, permits, checklists, QC, photo evidence |
| Procurement | trade partners, bid packages, purchase orders, receipts, equipment |
| Finance | forecasts, milestones, invoices, credits, payables, expenses, handoffs |
| Documents | controlled revisions, SDS, drawings, transmittals, meetings, NCRs |
| Performance | scorecard, governed framework catalog/revisions, feedback, energy/environment, lessons and learning |
| Approvals | approval queue, decisions, package and communication gates |
| Operations | identity, readiness, safety stop, backup/export/restore, HAI feed status/publication, audit, previewed QA archive |
| Client portal | approved job summary, documents, change responses, feedback |

## Error and replay contract

- JSON errors use a stable machine-readable code and human-readable message.
- Authentication is `401`; authorization is `403`; missing resources are `404`;
  immutable/source/replay conflicts are `409`; safety suspension is `423`; input
  failures are `400`/`413`/`415`; throttling is `429`; readiness failure is `503`.
- Every retry-sensitive write uses an idempotency key or retained source identity.
  Exact retries replay; changed payloads fail rather than producing a second effect.
- Package preparation, internal approval, external delivery, acceptance, payment,
  and certification are distinct states and endpoints.

## Security review

- `/api/ledger/debug` is owner-only.
- Operations safety-control writes are owner-only and require explicit phrases.
- QA-maintenance preview/write routes are owner-only and local-SQLite-only. The
  write requires a current plan hash and reason, verifies a backup, and rechecks
  membership inside the archive transaction.
- The support bundle is owner-only and aggregate/minimized by construction.
- HAI status and publication are owner-only; publication requires an absolute
  configured path, atomically replaces and verifies the read-only feed, and
  cannot execute a command or create an external commitment.
- Evidence reads pass through authenticated ledger routes; upload and portal routes
  enforce resource ownership and narrow capability.
- Detailed provider and database state is not exposed by the public health route.

## Known gaps

- A generated OpenAPI schema is not currently the source of truth; contract tests
  and route assertions are. Introducing one should be incremental and checked
  against all 379 routes rather than publishing a partial schema.
- Some components build endpoint paths dynamically, so static call-site counts are
  an audit indicator, not a proof that every path is reached.
- Real external provider endpoints remain disabled until provider-specific receipt
  and failure acceptance tests are configured.
