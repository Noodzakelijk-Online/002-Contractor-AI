# Acceptance Tests

Statuses in this document describe the required release gate. Actual command
results for the current revision are recorded in `FINAL_VERIFICATION_REPORT.md`.

| ID | Acceptance outcome | Evidence |
| --- | --- | --- |
| A01 | Fresh local startup applies all 71 migrations and reports ready | startup/readiness and migration tests |
| A02 | Production startup fails without auth and hosted durability declarations | auth and startup-readiness tests |
| A03 | Owner can complete persistent guided business setup and the identity appears on governed packages | onboarding, operations and issue-package tests |
| A04 | Opportunity intake, qualification, survey, conversion, and follow-up persist | opportunity, market-fit, bid, survey tests |
| A05 | WBS takeoff and rate build-up produce server-derived traceable estimate values | takeoff and estimate-rate tests |
| A06 | Quote approval, package creation, delivery, and acceptance remain separate | quote issue and communication tests |
| A07 | Schedule, crew, task, attendance, daily cycle, and Last Planner controls persist | planning and field tests |
| A08 | LMRA, permit, SDS, drawing, QC, NCR, and photo gates fail closed | assurance/evidence tests |
| A09 | Variation approval alone cannot contact a client or alter contract value | formal-variation and change-order tests |
| A10 | Procurement requires compliant trade partners and separate order delivery | bid-package, purchase-order, supplier tests |
| A11 | Invoice, credit, payable, receipt, and payment evidence reconcile without moving money | finance tests |
| A12 | Client portal tokens are scoped, expiring, job-bound, and approval-gated | client-portal and feedback tests |
| A13 | Duplicate or changed retries cannot create duplicate retained effects | idempotency/replay tests |
| A14 | Audit mutation, deletion, sequence gaps, or stale heads fail integrity/readiness | audit-integrity tests |
| A15 | Private evidence rejects unsafe types, traversal, tampering, and public serving | evidence and file-safety tests |
| A16 | Owner stop blocks scheduler and command application but permits dry run | operations-safety and scheduler tests |
| A17 | Support bundle and doctor expose diagnostics without records or secrets | operations-safety test and doctor smoke |
| A18 | Backup verifies DB/evidence hashes; restore revokes sessions, deactivates managed keys, and preserves integrity | backup/restore tests |
| A19 | Local backup migrates into an empty PostgreSQL/S3 target with parity | hosted migration contract test |
| A20 | Desktop/mobile navigation, onboarding, team access, loading, error, empty, offline, and field flows render | isolated Chromium browser suite |
| A21 | Build output is served by the production Node runtime with no legacy app | release-contract and container tests |
| A22 | Container runs non-root/read-only, handles signals, and retains state | container verification script |
| A23 | CORS, CSRF origin, proxy trust, rate limiting, sessions, and role boundaries hold | security integration tests |
| A24 | Hosted mode refuses non-EU/non-TLS/non-private/non-backed-up configuration | startup-readiness tests |
| A25 | Lint, dependency audit, release and HAI contracts, Node tests, build, browser, Windows package, and container gates pass | CI and final report |
| A26 | All 23 framework families and 700 memberships are searchable; family playbooks expose guarded cadence and measure starters without fabricating evidence; scoped records retain immutable revisions and surface due reviews without execution authority | catalog, framework workspace, PostgreSQL, backup, HAI, and browser tests |
| A27 | A deterministic production-scale local ledger preserves historical search, full pipeline totals, bounded responses, audit integrity, startup/write latency, memory, and disk thresholds | ledger benchmark unit contract, `npm run benchmark:ledger`, and CI JSON artifact |
| A28 | Owner-managed team provisioning returns a key once, stores only a hash, scopes field access, redacts lists, and revokes sessions on rotate, deactivate, restore, and hosted migration | managed-access API, ledger, restore, PostgreSQL, and browser tests |
| A29 | Privacy-rights requests retain minimized identity evidence, deadlines, source-current assessments, independent approvals, restrictions, corrections, exports, and only supportable erasure outcomes | privacy ledger, API, recovery, PostgreSQL, and browser tests |
| A30 | Contractor.AI emits HAI `accountfeed.GenericItem` records that the maintained HAI parser accepts and normalizes to read-only `review_document` work with zero external commitments | HAI unit, release, Windows package, and maintained-parser verification |
| A31 | Sign-in, all primary owner workspaces, representative dialogs, mobile navigation, and mobile/desktop client portal surfaces have zero axe violations for the selected WCAG 2.0/2.1 A/AA and WCAG 2.2 AA rules | pinned accessibility browser gate and `ACCESSIBILITY.md` |

## Manual provider acceptance

The following tests cannot be truthfully completed from repository code alone:

- send one message through each enabled provider and reconcile its provider receipt;
- verify accounting, Peppol, banking, mapping, calendar, weather, and AI scopes;
- restore a managed PostgreSQL snapshot and an object version in the chosen EU
  provider;
- inspect the signed DPA, data residency, subprocessors, retention schedule, and
  incident process;
- execute a canary and rollback through the selected production ingress.

Until each provider passes its test, its external action remains disabled or
approval-blocked. A UI success state is never accepted as provider evidence.
