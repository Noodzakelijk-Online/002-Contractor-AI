# Changelog

All notable changes to Contractor.AI are recorded here. Versions follow Semantic
Versioning for the application contract; database migrations remain append-only.

## Unreleased

### Added

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

### Changed

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
