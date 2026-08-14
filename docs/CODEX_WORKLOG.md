# Codex Worklog

- Localized the governed quality and closeout chain in Dutch and English:
  before/during/after photo evidence, installation and quality-control inspection
  checklists, punch items, warranty claims, aftercare, client feedback, handover,
  and recurring-service preparation. Retained titles, observations, measurements,
  witnesses, locations, comments, filenames, and other operator evidence remain
  verbatim across language changes.
- Expanded the lazy specialist operator catalog from 1,416 to 1,730 unique keys
  with no duplicates or missing literal keys for the targeted controls. Existing
  browser journeys now prove Dutch rendering and an English round trip after the
  full approval-backed quality and closeout lifecycles.
- Fixed a preference race where a background refresh started before a successful
  locale change could later restore its older session snapshot. The active
  operator choice now wins for the current session, failed writes roll back, and
  sign-in/sign-out clear the override.
- Localized the complete governed daily execution chain in Dutch and English:
  daily start huddles and end-of-day reports, approved production baselines,
  offline installed-output capture and reversals, and regiewerk quantity,
  receipt-only acknowledgement, and source-bound variation conversion.
- Expanded the lazy specialist operator catalog from 1,208 to 1,416 unique keys
  with no duplicates or missing literal keys for the targeted controls. Existing
  browser journeys now prove Dutch rendering and exact retained English field
  notes, quantities, cost codes, rationale, and evidence across locale changes.
- Localized the complete source-bound commercial workflow in Dutch and English:
  written scope and allowances, project risk and premortem, fixed-price-versus-regie
  selection, estimate and quote registers, acceptance evidence, verified delivery,
  and numbered formal variations. The same retained English contract and risk
  evidence remains unchanged when the interface switches to Dutch.
- Expanded the lazy specialist operator catalog from 903 to 1,208 unique keys and
  extended the governed commercial browser journey with Dutch form, decision, and
  estimate assertions plus an explicit English round trip.
- Localized the complete WBS/quantity-takeoff, labour-burden, overhead-recovery,
  estimating-rate policy, and unit-rate build-up surface in Dutch and English,
  including create, edit, remove, conversion, and policy dialogs. Operator-entered
  policy names, labour classes, work packages, descriptions, notes, and source
  references remain unchanged when the display language changes.
- Kept the expanded 903-key operator catalog out of the English startup path by
  loading it only when Dutch is active. The rejected eager implementation grew the
  main chunk to 582.29 kB; the corrected build is 531.51 kB and passes the bundle
  budget at 397,789 total gzip bytes.
- Extended the existing browser takeoff journey to prove Dutch rendering after a
  complete governed estimate conversion while preserving retained English project
  evidence. Focused and complete browser gates pass, including all 90 workflows in
  23 isolated batches.
- Added bounded tab-scoped draft recovery across central operator, field, and
  client-portal forms. Drafts are principal-scoped, expire after 12 hours, exclude
  secret-shaped fields/files, enforce per-entry/total limits, clear on sign-out,
  and cannot create a ledger record without explicit submission.
- Added the dedicated Vitest/Testing Library frontend gate and CI/release-contract
  enforcement. Six component/hook tests and a new Chromium reload workflow cover
  restoration, scope isolation, privacy limits, QA dialog behavior, no implicit
  ledger write, and intentional lifecycle clearing.
- The full browser run exposed and fixed overly broad selected-job recovery that
  reopened a workspace over explicit Today navigation. All 90 workflows now pass
  in 23 isolated batches, including the commercial and daywork reload regressions.
- Hardened Windows packaging for a running standalone preview: a locked bundled
  Node binary is reused only when its version exactly matches, while every other
  package artifact is cleaned and rebuilt. The refreshed package passed its full
  Node 22.23.2 runtime verification without stopping the existing preview.
- Gates at that checkpoint passed: 6 frontend tests, 532 Node tests, 90 Chromium workflows,
  zero dependency vulnerabilities, lint, release/build/bundle, maintained HAI
  parser, smoke and production performance, hardened container, and Windows
  standalone verification.
- Audited every retained request-supplied `...By` identity after approval-principal
  hardening. Internal creator, submitter, completer, releaser, and reviewer
  provenance now always prefers the trusted caller; external recipient, custodian,
  technician, inspector, and named-worker evidence remains distinct from the
  immutable audit actor.
- NCR closure now retains the named verifier and authenticated verifier principal
  together, hashes that principal into the pending decision, records it as the
  closing principal, and prevents that operator from approving the same closure.
- Pending closures from the preceding schema retain their original decision hash;
  replay is limited to the retained requester principal and an independent
  authenticated resolver can complete the upgraded closure.
- Extended the release source guard and domain/API regressions across progress,
  daywork, expenses, environmental reporting, assignments, meetings, controlled
  documents, worker instructions, and NCR closure.
- Current gates pass: 532 Node tests with 496 passes and 36 service skips, 89
  Chromium workflows in 23 batches, zero dependency vulnerabilities, lint,
  release/build/bundle, maintained HAI parser, smoke and production performance,
  hardened container, and rebuilt Node 22.23.2 Windows standalone verification.
- Canonicalized approval requester and resolver provenance. The trusted caller now
  wins before identity is persisted or reused by downstream releases, chained audit
  history, or independent-review checks; direct internal compatibility fallbacks
  remain available only when no trusted caller principal is supplied.
- Removed 65 residual route workflow-label fallbacks and bound those mutations to
  `local:owner`, the authenticated role principal, or `client_portal`. The release
  verifier now rejects both fallback routes and submitted-first approval principals.
- Added direct-ledger and local HTTP regressions proving submitted requester,
  resolver, and actor labels cannot enter the approval or audit record. The focused
  source, authentication, installation-QC, and photo-evidence set passes.
- The exact-source release gate passes with 530 Node tests, 89 Chromium workflows
  in 23 batches, zero dependency vulnerabilities, production build and bundle,
  native and maintained-parser HAI checks, smoke and 63,500-row performance,
  hardened container, and Node 22.23.2 Windows standalone verification.
- Normalized all 164 explicit HTTP mutation actor sites to the canonical trusted
  request principal. This closes the residual consistency gap in handlers that
  clone or reshape a parsed body before invoking the ledger.
- Extended the release contract to reject future request-body-derived actors and
  added API evidence that both intake and cloned-body equipment custody mutations
  ignore a spoofed owner label while retaining `local:owner` in chained history.
- The complete regression run exposed a sub-second work-permit fixture race under
  load. Permit creation, readiness, and approval expiry now honor the injected
  ledger clock; deterministic expiry coverage replaced the sleep, and all 527 Node
  tests pass with 491 local passes, 36 environment skips, and zero failures.
- The exact-source release gates pass: zero dependency vulnerabilities, 89 Chromium
  workflows in 23 isolated batches, production build and bundle budgets, native and
  maintained-parser HAI contracts, the 63,500-row benchmark, hardened container,
  Node 22.23.2 Windows standalone, and the smoke performance profile.
- Closed the remaining local-mode audit identity gap at the shared Express request
  boundary. Parsed object bodies now receive only `local:owner`, the authenticated
  role principal, or `client_portal`; submitted labels are non-enumerably replaced
  before any current or future ledger mutation route can consume them.
- Added an API and persisted-database regression proving a spoofed owner label does
  not enter either chained audit history or raw intake source JSON. Lint, dependency
  audit, release contract, production build, bundle/HAI contracts, all 527 Node
  tests, all 89 Chromium workflows, container runtime, Windows standalone, and the
  smoke performance profile pass.
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

## 2026-08-14 - Practical-core bilingual workflow pass

- Passed the persisted operator locale through the ledger-backed Pipeline workspace
  into the ICP/service-area, bid/no-bid, and preconstruction site-survey controls.
- Localized interface actions, states, empty content, form labels, dialog copy, and
  accessible names while leaving retained policy, checklist, and evidence text intact.
- Extracted specialist translations from the eagerly loaded shell locale into a
  lazy shared catalog; the production base locale returned to 12.79 kB.
- Added an NL persistence round-trip, Dutch axe scan, site-survey locale interaction,
  and retained desktop/mobile containment checks to the production-bundle browser flow.
- Fixed the browser-discovered lowercase English site-survey status regression and
  reran the complete survey-to-estimating approval flow successfully.
- Final current-source gates pass: 10 frontend tests, 533 Node tests, all 90
  Chromium workflows, release/build/bundle, dependency audit, hardened container,
  and Node 22.23.2 Windows standalone verification.

## 2026-08-14 - Capacity and liquidity bilingual pass

- Passed the persisted operator locale into the crew-capacity/two-week planning
  board and the approval-backed 13-week cash-flow forecast.
- Localized forms, tables, summaries, empty states, approval actions, accessible
  names, and known system-generated blockers/warnings while keeping retained job,
  worker, source, and unknown provider text verbatim.
- Added structured crew blocker context so localized messages interpolate retained
  names, dates, and hours without parsing presentation strings.
- Added Dutch cash-flow reload persistence, an axe scan, crew-board locale checks,
  translation contracts, and structured blocker assertions.
- Current-source gates pass: 10 frontend tests, 533 Node tests in 333.5 seconds,
  all 90 Chromium workflows in 554.7 seconds, release/build/bundle at 388,474
  total gzip bytes, zero dependency vulnerabilities, HAI contract, production
  benchmark, hardened container, and Node 22.23.2 Windows package verification.

## 2026-08-14 - Field planning and safety bilingual pass

- Passed the persisted operator locale into Last Planner weekly control, office and
  field 5S, and the worker-owned LMRA workflow, including the nested Resources path.
- Localized static controls, known statuses, validation messages, offline notices,
  accessible names, and system outcomes while preserving user-entered promises,
  findings, hazards, evidence references, and retained standards verbatim.
- Added exact interpolation contracts plus Dutch-to-English browser round trips with
  reload persistence before completing the existing approval, corrective-action,
  live-LMRA, stop-work, and responsive mobile workflows.
- The operator catalog now has 754 unique case-sensitive entries with no duplicate
  keys and remains a lazy shared production chunk.
- Current-source gates pass: 10 frontend tests, 533 Node tests in 74.5 seconds, all
  90 Chromium workflows in 490.5 seconds, release/build/bundle at 394,091 total
  gzip bytes, HAI fail-closed contract, production benchmark, hardened container,
  and Node 22.23.2 Windows package verification.
