# Codex Worklog

- Replaced the final browser-native confirmation in the canonical dashboard with
  a lazy-loaded QA-maintenance dialog that previews exact server-derived counts and
  samples, requires a retained reason and exact phrase, traps focus, restores the
  initiating control, and contains loading, stale-plan, empty, and error states.
- Removed a 500-row maintenance blind spot by inventorying all eligible active QA
  records directly. The owner-only write now rejects changed or empty plans,
  independently verifies its backup, rechecks membership inside one transaction,
  and archives or retires records together with pending-approval rejection and a
  plan-hashed audit event.
- Focused Node/source tests and desktop/mobile in-app Browser checks passed. The
  isolated Chromium workflow proves axe, keyboard cancellation, successful focus
  restoration, backend state, mobile containment, and the empty follow-up state;
  the browser inventory is now 89 workflows.
- The full release gate passed with zero dependency vulnerabilities, 525 Node
  tests, 89 Chromium workflows in 23 isolated batches, production build/bundle,
  63,500-row benchmark, hardened container, maintained HAI parser, and Node 22.23.2
  Windows standalone. A final cancellation-race and audit-actor hardening pass was
  then rechecked by its focused Node, source, browser, lint, build, and bundle gates.
- Replaced the owner automation-stop browser prompt/confirm sequence with a
  lazy-loaded reason-and-acknowledgement dialog that traps focus, supports Escape,
  restores initiating focus, shows retained control context, and keeps API errors
  inside the decision surface.
- Added a complete browser workflow proving suspend persistence, scheduler refusal,
  command-plan refusal, cancellation focus restoration, accessible resume, and
  mobile containment. The browser inventory is now 88 workflows.
- The populated-state dialog scan exposed low-contrast secondary text in retained
  automation and audit rows behind the modal. Those dynamic row palettes now meet
  the same axe gate as empty-state Operations.
- Added a pinned axe WCAG A/AA release gate for production sign-in, all twelve
  owner workspaces, representative dialogs, mobile navigation, and the client
  portal at mobile and desktop widths.
- Fixed shared compact-text contrast in tables, schedule and crew planning,
  finance summaries, resource tabs, field assurance, onboarding, performance,
  framework, and client-portal surfaces without excluding any axe rule.
- The full browser release gate now passes 87 workflows in 22 isolated batches,
  including all four accessibility checks and the independent production sign-in
  scan in the authentication workflow file.
- Reconciled the HAI connector with the maintained HAI account-feed parser. The
  previous normalized shape omitted required `provider` and `itemType` fields;
  the export now emits `accountfeed.GenericItem`, rejects retired fields, and has
  native, Windows-package, CI, and optional actual-parser compatibility gates.
- Verified the generated fixture through maintained HAI `ParseGenericFeed` in an
  isolated network-disabled Docker Go runtime without changing the HAI checkout.
  Lint, dependency audit, release/HAI contracts, 525 Node tests, build/bundle,
  production-scale benchmark, container, Node 22 Windows package, 87 browser
  workflows, and retained-ledger
  startup all passed.

## 2026-08-09 - Privacy rights operations pass

- Added migration 071 and an owner-controlled register for client and worker
  access, rectification, erasure, restriction, portability, and objection requests.
- Added minimal identity-evidence references, calendar-month deadlines, bounded
  extensions with requester-notification evidence, live source inventories, legal/retention assessment references,
  independent source-current approval, and private checksummed JSON exports.
- Enforced restriction and direct-marketing objections in relevant new processing;
  rectification and blocker-aware partial pseudonymisation preserve immutable
  financial, contractual, safety, approval, and audit evidence.
- Wired diagnostics, operational export, backup/restore validation, hosted migration,
  PostgreSQL parity, capability reporting, and the Windows standalone smoke to the
  new lifecycle without claiming automatic disclosure or complete erasure.
- Added the responsive Operations register and verified the full release gate:
  zero-vulnerability production audit, lint, release contract, 524 Node tests,
  83 Chromium workflows, build and bundle budgets, production-scale benchmark,
  hardened container, live local readiness, and Node 22.23.2 Windows packaging.

## 2026-08-09 - Persistent owner onboarding pass

- Replaced the first-run redirect with a four-step owner setup workflow for legal
  identity, office/contact details, billing defaults, and readiness review.
- Persisted each completed step through the canonical organization ledger API;
  no browser storage, inferred business values, or weaker issue gate was added.
- Added keyboard escape/focus cycling, opener focus restoration, compact mobile
  progress controls, exact validation messages, and the existing Operations editor
  remains the complete post-setup maintenance surface.
- Browser-tested a fresh-ledger setup at 390x844 through server readiness and then
  verified the retained record in the desktop Operations editor.
- Split onboarding into lazy JS/CSS assets so normal dashboard startup does not
  pay for the owner-only first-run flow.
- The complete release gate passed: zero-vulnerability audit, lint, release
  contract, 509 Node tests, 81 isolated Chromium workflows, production build,
  bundle budget, container runtime, and a Node 22.23.2 Windows package smoke with
  ready storage, compact framework catalog, read-only HAI feed, and no key leakage.

## 2026-08-09 - Framework method playbook pass

- Added a validated operating playbook to every one of the 23 framework families:
  recommended scope, review cadence, evidence prompts, measure candidates, and
  safeguards.
- Added the method basis to the framework review dialog and a guarded starter that
  fills only missing review cadence and measures. It never retains suggested
  evidence as proof.
- Added an explicit compact-family representation for the dashboard, reducing its
  complete catalog response from 320,592 to 183,602 bytes while adding the
  playbooks. The default API retains the prior nested-guidance contract.
- Browser-tested the workflow at 1280x900 and 390x844 with no console errors, page
  errors, or horizontal overflow; the focused framework lifecycle test passed.

## 2026-08-09 - Governed framework implementation pass

- Parsed goal sections 1-23 into a deterministic ASCII-safe catalog containing
  23 families, 671 unique frameworks, and 700 family memberships.
- Added migration 069, scoped implementation records, immutable checksum-protected
  revisions, guarded transitions, exact replay, concurrency checks, diagnostics,
  backup validation, export, role APIs, and PostgreSQL parity coverage.
- Added the lazy-loaded Performance framework register with bounded pagination,
  search, family/status filters, evidence, measures, decisions, review dates, and
  revision history on desktop and mobile.
- Routed due framework reviews into the internal command plan and read-only HAI
  feed without adding autonomous execution or external commitment authority.
- The complete release gate passed: zero-vulnerability audit, lint, release
  contract, 509 Node tests, 80 isolated Chromium workflows, production build,
  bundle budget, Docker runtime migration 069, and Node 22.23.2 Windows package
  runtime/catalog smoke. Exact results and external boundaries are retained in
  `FINAL_VERIFICATION_REPORT.md`.
- Hardened the Windows launcher after runtime verification showed that repeat
  starts could retain the owner key in redirected logs. The key is now displayed
  only on first run, later starts report the protected configuration path, the
  exposed key was rotated, and the key-bearing local logs were cleared.

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

## 2026-08-09 - Production-scale ledger performance pass

- Added deterministic disposable smoke and production benchmark fixtures with
  canonical schema, foreign keys, valid SHA-256 audit chains, and one measured
  canonical intake write against retained scale.
- The production profile retains 63,500 core rows: 5,000 requests/jobs, 20,000
  tasks, 2,500 opportunities, 5,000 approvals, and 25,000 audit events.
- Fixed job/opportunity filtering after a 500-row window and replaced bounded
  in-memory opportunity forecasting with complete database aggregation.
- Profiled dashboard command generation and moved assignment and handover
  eligibility checks before expensive job-detail assembly.
- Packaged Node 22.23.2 measurement reduced dashboard p95 from 5,951.57 ms to
  620.83 ms; canonical intake p95 was 86.24 ms and every retained threshold passed.
- Added smoke contract tests, CI production gate/report upload, release scripts,
  operator guidance, acceptance outcome A27, and phase 051/052 completion evidence.
