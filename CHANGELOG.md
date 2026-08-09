# Changelog

All notable changes to Contractor.AI are recorded here. Versions follow Semantic
Versioning for the application contract; database migrations remain append-only.

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
