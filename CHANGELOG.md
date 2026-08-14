# Changelog

All notable changes to Contractor.AI are recorded here. Versions follow Semantic
Versioning for the application contract; database migrations remain append-only.

## Unreleased

- Localized the complete workforce-readiness chain: retained crew records,
  qualification requirements and credential evidence, operational availability,
  assignment safeguards, and governed work permits through approval, worker
  acknowledgement, suspension, and closeout. Canonical evidence remains verbatim.
- Fixed stale editor recovery after successful saves, comma corruption in
  line-delimited permit evidence, singular/plural lifecycle copy, and shared WCAG
  contrast failures across resource and field workspaces.
- Localized owner business onboarding and identity, managed team access, autonomous
  safety controls, and QA archive maintenance. Added a Dutch mobile owner journey
  covering retained identity, one-time access-key handling, key rotation,
  deactivation, suspend/resume, QA preview, English round trip, accessibility,
  responsive containment, exact API evidence, and empty browser error logs.
- Added migration 072 with self-scoped, audited NL/EN operator preferences that survive local restart and local-to-hosted migration.
- Added retained language selection to approval-gated client portal links, plus a token-scoped client language control.
- Localized the operator shell and complete client portal, including locale-aware dates, numbers, and EUR values.
- Localized the ledger-backed Ideal Customer Profile/service-area, bid/no-bid, and preconstruction site-survey workflows, including actions, empty states, decision statuses, and accessible names while preserving retained operator evidence verbatim.
- Localized the crew-capacity/two-week planning board and 13-week cash-flow forecast, including structured system blockers, warnings, forms, tables, approval states, and accessible names while preserving retained worker, job, and source evidence verbatim.
- Localized the complete governed commercial workflow: written scope, assumptions, exclusions, allowances, project risk register and premortem, fixed-price-versus-regie decision, estimates, quote packages, client acceptance evidence, provider delivery receipts, and formal variations. Retained contract evidence remains verbatim across locale changes.
- Localized the governed daily execution chain: start huddles and end-of-day reports, approved production baselines, offline installed-output capture and reversals, and regiewerk quantity, acknowledgement, and variation conversion. Retained worker notes, measurements, cost codes, and evidence references remain verbatim across locale changes.
- Localized governed before/during/after photo evidence, installation and quality-control inspections, punch/warranty/aftercare/feedback closeout, and client-success handover controls. Explicit language changes now remain stable when an older background refresh completes after a preference update.
- Split specialist operator translations into a lazy shared chunk so the initial shell retains its smaller base locale payload.
- Added API, migration, restore, frontend, and browser regression coverage for locale isolation and persistence.

### Added

- Tab-scoped, operator-isolated recovery for unfinished intake, opportunity, bid,
  commercial, workforce, equipment, client, scheduling, field, and client-portal
  forms, with bounded retention, secret/file stripping, expiry, and logout cleanup.
- A dedicated Vitest/Testing Library frontend gate with behavioral coverage for
  draft recovery and the QA archive decision dialog, plus a reload-based browser
  regression proving drafts do not create ledger records and clear on close.
- A checked-in catalog of 23 contractor operating families, 671 unique
  frameworks, and all 700 source family memberships.
- Migration `069_governed_framework_workspace` with organization/project scope,
  guarded lifecycle transitions, exact replay, optimistic concurrency, immutable
  revision snapshots, backup validation, hosted PostgreSQL parity, and diagnostics.
- A responsive searchable framework register under Performance with family/status
  filters, bounded pagination, evidence, measures, review dates, and revision history.
- Validated method playbooks for all 23 framework families with guarded cadence
  and measure starters that never retain suggested evidence as proof.
- Due framework reviews in the internal command queue and read-only HAI feed with
  no execution authority or external commitment.
- A four-step first-run owner wizard for legal identity, office/contact details,
  billing defaults, and server-validated readiness, with durable step saves and
  responsive keyboard-accessible interaction.
- A deterministic disposable ledger benchmark with smoke and 63,500-row production
  profiles, correctness/resource/latency thresholds, and a retained CI JSON report.
- Migration `070_managed_operator_accounts` and an owner-only Team access register
  for named owner, approver, office, and field accounts with scoped access, one-time
  generated keys, immediate rotation, session revocation, and retained deactivation.
- Migration `071_data_subject_request_governance` and an owner-only privacy-rights
  register for access, rectification, restriction, erasure, portability, and
  objection requests with identity, deadline, assessment, and approval controls.
- A pinned axe browser gate covering selected WCAG 2.0/2.1 A/AA and WCAG 2.2 AA
  rules across sign-in, every primary workspace, representative dialogs, mobile
  navigation, and the mobile/desktop client portal.
- A dedicated owner automation suspend/resume dialog with retained control context,
  explicit acknowledgement, keyboard focus management, and responsive layout.
- A dedicated owner QA-maintenance dialog with a server-derived record preview,
  bounded samples, exact confirmation, retained reason, keyboard focus management,
  inline stale-plan recovery, verified-backup boundary, and responsive empty state.

### Changed

- Windows standalone packaging can refresh a verified release folder while its
  matching bundled Node executable is in use, preserving only that locked runtime
  and replacing every application, dependency, launcher, and build file.
- Approval requests and resolutions now retain one canonical server-selected
  principal across decision records, downstream releases, audit events, and
  independent-review checks. Local callers cannot substitute `requestedBy`,
  `resolvedBy`, `actor`, or a workflow-label fallback for `local:owner`.
- Governed work-permit creation, readiness, and approval expiry checks now use the
  ledger clock consistently. Expired permits still fail closed, while deterministic
  lifecycle tests no longer depend on sub-second wall-clock timing.
- Owner automation control no longer relies on browser-native prompt and confirm
  surfaces; validation and API failures remain inside the auditable decision flow.
- QA/demo cleanup no longer relies on a browser-native confirmation or a bounded
  dashboard list. The server inventories every eligible active record, hashes the
  exact plan, rejects stale or empty submissions, verifies the recovery package,
  and applies approval rejection plus archive/retirement in one transaction.
- Compact supporting text and control palettes now meet the automated contrast
  gate across planning, finance, resources, field assurance, analytics, onboarding,
  Operations, and client-facing project facts. The Operations restore-file input
  and empty audit-history register also expose correct accessible semantics;
  populated automation and audit rows retain compliant secondary-text contrast.
- The HAI export now emits the maintained `accountfeed.GenericItem` input shape
  (`generic_json_feed` provider and `document` item type), which HAI normalizes to
  read-only `review_document` work. A native CI gate and optional maintained-parser
  verifier prevent the former incompatible normalized-feed shape from returning.
- Operational exports and support diagnostics now include governed framework
  records and revision counts.
- Long framework lists and summaries use bounded database filtering and aggregate
  queries in SQLite and PostgreSQL.
- The dashboard uses an explicit compact-family catalog representation, reducing
  its full catalog response while the default API retains prior nested guidance
  compatibility and keeps family playbooks available once per family.
- Windows standalone starts only display the owner key when the protected runtime
  configuration is first created; later starts report the configuration path.
- Owner onboarding JS and CSS load only when the guided first-run flow is opened.
- Job and opportunity search/filtering now executes before database limits, pipeline
  forecasts aggregate every matching record, and autonomous dashboard queues avoid
  full job-detail assembly for unassigned crews or ineligible handover records.
- Local restore and local-to-hosted migration preserve managed account records but
  deactivate every active key, requiring an owner to issue new environment-specific
  access after recovery.
- Operational exports, diagnostics, backup validation, hosted migration, and the
  HAI-safe capability contract now retain privacy-request state and deadlines.

### Security

- Governed progress, field-submission, assignment-release, meeting-action, and
  document/instruction-review records now retain the trusted operator before any
  submitted creator, submitter, completer, releaser, or reviewer label. NCR closure
  also retains a source-hashed authenticated verifier principal and blocks that
  operator from approving the same closure. Pending closures from the prior format
  retain their original hash while replay and independent approval use the trusted
  requester principal. The release contract rejects future submitted-first
  operational provenance expressions.
- Local and hosted request bodies can no longer choose their retained audit actor.
  The server assigns `local:owner`, the authenticated role principal, or the
  token-scoped `client_portal` identity; every explicit mutation route consumes
  that trusted principal directly, and submitted actor labels are excluded from
  retained business payloads. The release contract rejects new request-derived
  actor expressions.
- Prevented repeat standalone starts and redirected runtime logs from disclosing
  the retained owner access key.
- Managed account credentials are retained only as domain-separated SHA-256 hashes;
  plaintext keys are returned once with no-store responses and never enter browser
  storage, list APIs, diagnostics, exports, or audit events.
- Privacy exports require verified identity, a source-current assessment, and an
  independently approved decision. Full identity documents are prohibited, and
  partial pseudonymisation is never represented as complete erasure.
- Response-deadline extensions require a retained requester-notification reference,
  and that evidence remains intact through approval completion.

## 1.1.0 - 2026-08-09

### Added

- Durable owner-controlled suspension and resumption of autonomous drafting.
- A privacy-minimized owner support bundle and `npm run doctor` diagnostic CLI.
- Hosted readiness enforcement for a retained data-retention policy reference.
- A first-run business-identity prompt and a global automation-stop indicator.
- Migration `068_operational_safety_controls` with audit-backed control history.
- Portable Node 22 x64 Windows packaging, launcher, and private local data layout.
- Loopback-only ngrok startup with readiness validation and fail-closed credentials.
- Read-only HAI connector manifest, feed, API routes, export command, and package copy.
- Production compression, immutable asset caching, deterministic chunks, and bundle budgets.
- Production audit, acceptance, security, operator, task-graph, and completion
  documentation for phases 000 through 115 of the stabilization program.

### Changed

- `/api/ledger/debug` now requires the owner role.
- Hosted readiness, capability reporting, and scheduler status expose operational
  safety state without exposing secrets.
- Autonomous scheduler claims and command-plan application fail closed while the
  owner safety stop is active; dry runs remain available for diagnosis.
- Dependency lockfile refreshed to resolve published package advisories.
- Job-scoped loading guards prevent stale material, safety, permit, LMRA,
  environmental, expense, and daily-cycle responses from replacing newer data.
- Browser verification now discovers all tests and runs isolated bounded batches.

### Security

- Support diagnostics exclude customer records, evidence contents, logs,
  environment values, credentials, and authentication material.
- Safety-control writes require an owner role and an explicit confirmation phrase.

## 1.0.0 - 2026-06-18

- Established the Node/Express operating ledger as the sole runtime.
- Added the React/Vite operator dashboard, SQLite local mode, PostgreSQL hosted
  mode, private evidence adapters, versioned migrations, backups, restore
  verification, approval gates, and contractor operating workflows.
