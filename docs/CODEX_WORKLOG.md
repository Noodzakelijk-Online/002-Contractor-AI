# Codex Worklog

## 2026-08-08 - Giant prompt implementation pass

### Discovery

- Read all 124 PDF pages and visually reviewed contact sheets for every page.
- Mapped phases 000-115 to the maintained Node/React operating-ledger runtime.
- Counted 358 Express routes, 68 migrations after this pass, 153 test files, and
  81 direct API call sites in the main dashboard.
- Reviewed repository status and preserved unrelated tracked state; starting tree
  was clean at `d1a89fbc73be714b6cb05bb7fbf554309c3387ea`.

### Implementation

- Added migration 068 and transactional owner safety-control methods.
- Enforced suspension in autonomous cycles, scheduler claims, and command-plan
  application while preserving dry-run and direct human operations.
- Added owner-only control and support-bundle endpoints with explicit confirmations.
- Added the doctor CLI, runtime version/release reporting, retention readiness, and
  owner-only debug authorization.
- Added global/Operations UI controls and first-run identity guidance.
- Bumped the release to 1.1.0 and refreshed the lockfile to remove advisories.
- Added and updated migration, safety, scheduler, hosted-readiness, PostgreSQL parity,
  restore, and release-contract tests.
- Added the twelve audit and operator artifacts mandated by the prompt plus a
  changelog.

### Verification ledger

Focused safety/scheduler tests passed before documentation was added. The release
contract initially failed only because the mandated documents did not yet exist;
that was an expected test-first result.

The final local gates passed on 2026-08-09: lint, zero-vulnerability dependency
audit, release contract, production build, bundle budget, 501 Node tests, 79
Playwright tests, container runtime, isolated runtime doctor, and portable Windows
Node 22 x64 packaging. Exact counts and external boundaries are retained in
`FINAL_VERIFICATION_REPORT.md`.

### Completion work

- Added gzip/Brotli-compatible HTTP compression, immutable hashed-asset caching,
  deterministic Vite chunking, and enforced JavaScript/CSS/gzip budgets.
- Added a portable Windows launcher/runtime/package builder with private local data,
  loopback binding, health checks, and a desktop entry point.
- Added a loopback-only ngrok launcher that validates runtime readiness and refuses
  missing credentials or unsafe bindings.
- Added a read-only HAI manifest/feed/API/export contract with no write authority.
- Made browser execution isolated and bounded, then fixed stale-response and form
  interaction races in identity, material, briefing, permit, LMRA, environment,
  expense, and daily-cycle workflows.
- Updated Docker and CI to verify HAI export compatibility, current action majors,
  Windows packaging, PostgreSQL TLS parity, browser workflows, and container safety.
- The first publication run exposed an Operations hydration race that could replace
  the first business-identity field after input began. The form now remains natively
  disabled until its retained profile loads, and the browser test verifies the save
  response and persistent readiness state instead of relying on a transient notice.

### Scope decisions

- Did not enable real external delivery without credentials and acceptance evidence.
- Did not claim legal, tax, Wkb, safety, energy, Peppol, or GDPR certification.
- Did not split the three largest modules during a stabilization release; the debt is
  recorded for contract-protected incremental extraction.
- Did not introduce destructive automatic retention or data-subject erasure.
