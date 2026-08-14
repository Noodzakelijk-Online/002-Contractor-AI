# Codex Checkpoints

This file is a compact resume boundary. A future implementation pass should verify
the repository rather than treating these statements as current by assumption.

## CP-23 Bilingual equipment lifecycle and physical custody

- Equipment registration, controlled statuses, office/field handoff, return and
  quarantine, inspection, maintenance, readiness, and approval-gated retirement
  now share the persisted NL/EN operator locale.
- Retained names, categories, locations, notes, findings, evidence references,
  meter values, principals, and ledger enums remain unchanged across locale
  switches; failed inspection and exceptional return safeguards remain fail closed.
- Browser QA covers the full Dutch lifecycle, reload persistence, exact API
  evidence, English round trip, mobile containment, empty error logs, and axe. The
  scan found and closed shared resource and custody contrast defects.
- Verification: 3,161 unique specialist translation keys with zero duplicates;
  10 frontend tests, 535 Node tests, 98 Chromium workflows in 25 isolated batches,
  release/HAI/lint/build/bundle, production benchmark, hardened container, and
  Node 22.23.2 Windows standalone gates pass.

## CP-22 Bilingual tender comparison and approved purchasing

- The tender register, bid returns, preferred-bidder review, purchasing commitment,
  immutable purchase-order package, and provider-receipt lifecycle now share the
  persisted NL/EN operator locale.
- Retained partner names, scope, rationale, exclusions, qualifications, and evidence
  references remain verbatim; external commitment remains blocked until separate
  approval and an allowlisted provider receipt exist.
- Browser QA covers Dutch creation through verified receipt, reload persistence,
  exact API evidence, English round trip, mobile containment, empty error logs, and
  axe. The scan found and closed low-contrast procurement summary labels.
- Verification: 2,997 unique specialist translation keys with zero duplicates;
  10 frontend tests, 535 Node tests, 97 Chromium workflows in 25 isolated batches,
  release/HAI/lint/build/bundle, production benchmark, hardened container, and
  Node 22.23.2 Windows standalone gates pass.

## CP-21 Bilingual job costing and cost-to-complete

- Finance readiness now localizes controlled metrics, statuses, actions, cost-code
  tables, source-review warnings, history, policy text, and accessible names while
  retaining budget descriptions, time notes, vendors, and receipt evidence verbatim.
- Warning counts and billing milestone sequence are structured ledger fields; the
  UI no longer derives these presentations from English message text.
- Accessibility: the horizontally scrollable forecast table is keyboard focusable,
  its focus state is visible, and compact summary text passes the Dutch axe scan.
- Verification: 2,843 unique specialist translation keys with zero duplicates;
  10 frontend tests, 534 Node tests, 96 Chromium workflows in 24 isolated batches,
  release/HAI/lint/build/bundle, production benchmark, hardened container, and
  Node 22.23.2 Windows standalone gates pass.

## CP-20 Bilingual field assurance and risk control

- Locale wiring: persisted operator locale reaches the field page, assurance queue,
  NCR register, observation/incident register, and assurance review dialog.
- Retained data: job, worker, evidence, title, fact, containment, correction, and
  verification text remains verbatim across NL/EN changes; only controlled labels,
  enums, recommendations, and validation outcomes are translated.
- Browser evidence: a Dutch observation survives reload, the assurance queue and
  review dialog render localized server actions, an English round trip preserves
  the retained API evidence, and the narrow field workspace has no overflow.
- Catalog: 2,705 unique specialist translation keys, zero duplicate keys, and the
  catalog remains lazy-loaded outside the English startup path.
- Verification: 10 frontend tests, 534 Node tests, 95 Chromium workflows in 24
  isolated batches, release/HAI/lint/build/bundle, production benchmark, hardened
  container, and Node 22.23.2 Windows standalone gates pass.

## CP-19 Bilingual setup and critical-path planning

- Locale wiring: persisted operator locale reaches job setup coverage and work-plan
  controls; all 91 capability/catalog labels and every planning action, status,
  form label, tooltip, and accessible name have Dutch presentation
- Retained data: job titles, task titles, assignees, and evidence remain verbatim
  across NL/EN round trips; only controlled catalog and enum copy is translated
- Responsive UI: the job summary uses a two-by-two narrow-screen grid with bounded
  wrapping; job setup and work-plan sections retain exact viewport containment
- Test isolation: QA archive verification consumes current server preview counts,
  so bounded browser batch changes cannot create false hard-coded count failures
- Verification: 10 frontend tests, 534 Node tests, 94 Chromium workflows in 24
  isolated batches, release/HAI/lint/build/bundle, production benchmark, hardened
  container, and Node 22.23.2 Windows standalone gates pass

## CP-18 Bounded draft recovery and frontend gate

- Recovery: central operator and client-portal form drafts survive reload inside
  the same tab without creating ledger records; job workspace navigation remains
  explicit and an intentional close clears recovered editor state
- Privacy/resource bounds: session-only storage is operator- or portal-fingerprint
  scoped, expires after 12 hours, strips secret-shaped fields and binary files,
  and enforces 128 KiB per-draft and 1 MiB total limits
- Delivery: CI now runs a dedicated Vitest/Testing Library gate; the release
  contract requires its source, scripts, workflow command, and storage boundaries
- Windows: a package refresh can preserve a locked, exact-version bundled Node
  executable while replacing every other release artifact, avoiding preview
  interruption and partial-package residue
- Verification: 6 frontend tests, 532 Node tests, 90 Chromium workflows, lint,
  zero-vulnerability audit, release/build/bundle, maintained HAI parser, smoke and
  63,500-row performance, hardened container, and Node 22.23.2 Windows gates pass

## CP-17 Governed operational principals

- Provenance: progress creation, field daywork, expense and environmental
  submissions, assignment release, meeting-action completion, and governed
  document/instruction review now prefer the trusted caller before compatibility
  identity fields
- NCR closure: the named verifier remains human-readable evidence while the
  authenticated verifier principal is retained in the source hash and `closedBy`;
  that principal cannot approve its own closure in authenticated operation
- Upgrade compatibility: pending NCR closures created before authenticated
  verifier retention preserve their original source hash, bind replay to the
  retained requester principal, and still require an independent resolver
- Prevention: the release contract rejects submitted-first operational provenance
  expressions for authoritative creator, submitter, completer, releaser, reviewer,
  issuer, recorder, and updater fields
- Verification: 532 Node tests, 89 Chromium workflows, lint, zero-vulnerability
  audit, release/build/bundle, maintained HAI parser, smoke and 63,500-row
  performance, hardened container, and Node 22.23.2 Windows gates pass

## CP-16 Canonical approval principals

- Boundary: approval requester and resolver identity prefer the trusted route or
  internal caller principal before any submitted compatibility field
- Propagation: the canonical resolver is reused by retained approval decisions,
  downstream release metadata, chained audit events, and separation-of-duty checks
- Routes: 65 remaining workflow-label actor fallbacks now use the same
  `trustedRequestActor(req)` boundary as every other mutation
- Prevention: the release contract rejects legacy route fallbacks, submitted-first
  approval principal expressions, and approval routes that do not overwrite identity
- Verification: 530 Node tests and 89 Chromium workflows pass with zero failures;
  lint, zero-vulnerability audit, release/build/bundle, maintained HAI parser,
  smoke and 63,500-row performance, container, and Node 22 Windows gates pass

## CP-15 Route-level audit principals

- Coverage: all 164 explicit mutation actor sites in the HTTP layer consume
  `trustedRequestActor(req)` instead of an enumerable or cloned request field
- Boundary: body binding still removes submitted actor labels from retained input;
  direct principal use also protects handlers that clone or reshape request bodies
- Prevention: the release contract scans canonical source and fails when a route
  assigns an actor from `req.body`, `payload`, `input`, or `body`
- Verification: focused API coverage proves both intake and cloned-body equipment
  custody events retain `local:owner` and never the submitted spoofed label
- Delivery: 527 Node tests, 89 Chromium workflows, dependency/release/build/bundle,
  maintained HAI parser, production benchmark, container, and Windows gates pass

## CP-14 Trusted request actors

- Boundary: every parsed object body receives a non-enumerable server-selected
  actor before a ledger route can use or retain it
- Identity: local work is `local:owner`, authenticated work uses the exact role and
  managed-account principal, and public portal mutations use `client_portal`
- Persistence: submitted actor labels are excluded from retained business payloads,
  including raw intake source data
- Verification: focused authentication/API persistence coverage plus the complete
  527-test Node gate passed with zero failures; release/browser/package gates are
  recorded in `FINAL_VERIFICATION_REPORT.md`

## CP-13 Previewed QA maintenance

- UI: dedicated lazy-loaded Operations dialog with exact record counts, bounded
  samples, reason and phrase confirmation, inline reload/error state, and explicit
  recovery/no-external-effect boundaries
- Consistency: the server hashes the complete eligible ID set; missing, empty, or
  changed plans fail before mutation, including a second check inside the ledger
  transaction
- Recovery: the local SQLite backup is independently verified before the atomic
  archive/retirement and pending-approval rejection; hosted mode remains blocked
  until a provider recovery point exists
- Accessibility: heading focus, trapped Tab/Shift+Tab, Escape cancellation,
  post-refresh initiating-focus restoration, axe coverage, and mobile containment
- Verification: the 525-test Node gate and all 89 Chromium workflows passed; the
  final cancellation-race/audit-actor hardening also passed focused Node, source,
  browser, lint, build, and bundle checks. Remaining gates are retained in
  `FINAL_VERIFICATION_REPORT.md`

## CP-12 Owner automation decision dialog

- UI: dedicated lazy-loaded suspend/resume dialog with retained status, revision,
  prior reason, new decision reason, and explicit acknowledgement
- Keyboard: heading focus on open, trapped Tab/Shift+Tab, Escape cancellation, and
  initiating-control focus restoration
- Safety: existing owner-only audited API remains authoritative; suspended state
  blocks durable scheduler and command-plan application while external commitments
  remain approval-gated in both states
- Verification: isolated Chromium workflow covers axe, persistence, API blocking,
  cancellation, resume, and 390x844 containment

## CP-10 Maintained HAI parser contract

- HAI input schema: `accountfeed.GenericItem` root array
- Required source identity: `provider: generic_json_feed`, `itemType: document`
- HAI-derived operation: `review_document`; Contractor.AI action type remains metadata
- Boundary: read-only export, `canExecute: false`, zero external commitments
- Verification: `npm run verify:hai-contract`; `--hai-root` executes the maintained
  parser from a temporary copy and does not modify the HAI checkout
- External boundary: parser acceptance is not a configured or live HAI sync

## CP-11 Automated accessibility assurance

- Engine: pinned `@axe-core/playwright` 4.12.1
- Standards tags: WCAG 2.0 A/AA, WCAG 2.1 A/AA, and WCAG 2.2 AA
- Scope: production sign-in, all twelve primary owner workspaces, representative
  dialogs, mobile navigation, and mobile/desktop client portal
- Enforcement: every matched violation fails the browser gate; no per-rule or
  per-component exclusions are retained
- Verification: full gate passed with 525 Node tests, 87 Chromium workflows in
  22 isolated batches, build/bundle budgets, production benchmark, hardened
  container, and Node 22.23.2 Windows package smoke
- External boundary: independent assistive-technology and user acceptance still
  requires representative production users and environments

## CP-00 Starting state

- Branch: `main`
- Revision: `d1a89fbc73be714b6cb05bb7fbf554309c3387ea`
- Tree at start: clean and synchronized
- Product: one Node/Express ledger runtime with React/Vite UI

## CP-01 Audit complete

- PDF pages reviewed: 124/124
- Prompt phases mapped: 000-115
- Canonical route declarations: 358
- Test files: 153
- Existing migrations before implementation: 67
- Material gaps selected: safety stop, minimized support/doctor, hosted retention
  declaration, first-run identity visibility, debug role restriction, durable docs

## CP-02 Code complete

- Migration: `068_operational_safety_controls`
- Release: `1.1.0`
- New operations contracts: control GET/suspend/resume and support bundle
- New CLI: `npm run doctor`
- New UI: global safety state, Operations control, first-run identity prompt
- Hosted readiness: retention-policy reference is mandatory

## CP-03 Test checkpoint

- Lint, dependency audit, release contract, build and bundle budget: passed
- Node: 501 tests, 468 passed, 33 environment-dependent skips, 0 failed
- Browser: 79 Chromium tests passed in 20 isolated batches
- Container, doctor and portable Windows Node 22 x64 package smoke: passed
- PostgreSQL parity remains a CI/service-backed gate
- Live ngrok, HAI, EU deployment and external providers remain credential- or
  infrastructure-dependent acceptance steps

## CP-04 Publication boundary

- All current implementation and documentation changes are intended for one release
  commit on `main`.
- Before trusting this checkpoint, verify the pushed commit and GitHub Actions result.
- Do not reinterpret source-compatible ngrok/HAI contracts as live-provider proof.

## CP-05 Governed framework workspace

- Catalog: 23 families, 671 unique frameworks, 700 family memberships
- Migration: `069_governed_framework_workspace`
- UI: searchable/paginated framework register under Performance
- Governance: organization/project scope, guarded statuses, exact replay,
  optimistic concurrency, immutable revision hashes, due-review triage
- Integration: export, backup verification, diagnostics, PostgreSQL contract,
  internal command plan, read-only HAI, desktop/mobile browser flow
- Verification: 509 Node tests, 80 Chromium workflows, release/build/bundle,
  container migration 069, and the Node 22.23.2 Windows package passed
- External boundary: no method certification, provider execution, spend, message,
  schedule commitment, or financial action is inferred from a framework record

## CP-06 Persistent owner onboarding

- The Today first-run action opens a four-step owner setup flow instead of routing
  to the complete Operations editor.
- Each successful step persists to the canonical organization profile; completion
  uses server readiness and retains all existing commercial issue gates.
- Mobile containment, final persistence, and Operations editor compatibility are
  covered by an isolated Chromium workflow.
- Verification: 509 Node tests, 81 Chromium workflows, release/build/bundle,
  container runtime, and the rebuilt Node 22.23.2 Windows package passed.

## CP-07 Production-scale ledger performance

- Profiles: smoke exceeds 500 jobs/opportunities; production retains 63,500 core rows.
- Correctness: historical search, complete pipeline aggregates, bounded results,
  required indexes, and 25,000-event audit integrity are enforced.
- Node 22.23.2 baseline: 1.51 s seed, 7.05 ms reopen, 620.83 ms dashboard p95,
  86.24 ms canonical-intake p95, 352.02 ms audit verification, about 37 MiB DB.
- Optimization: unassigned crew and handover-ineligible jobs no longer trigger full
  job-detail assembly during dashboard command generation.
- CI: `npm run benchmark:ledger` is a release gate and uploads its JSON evidence.
- Full local gate: release/lint/audit/build/bundle, 512 Node tests, production
  benchmark, hardened container, 81 isolated Chromium workflows, and rebuilt
  Node 22.23.2 Windows runtime smoke all passed.
- Hosted boundary: selected EU infrastructure still needs provider-specific load,
  recovery, ingress, database, and object-storage acceptance.

## CP-08 Owner-managed team access

- Migration: `070_managed_operator_accounts`
- Operations: owners add, rotate, reactivate, and deactivate named accounts while
  deployment principals remain redacted and environment-controlled.
- Security: generated keys are shown once, stored only as hashes, excluded from
  browser storage and audit output, and rotation/deactivation revoke sessions.
- Recovery: local restore and local-to-hosted migration deactivate all managed
  accounts so credentials from another recovery point or environment cannot revive.
- Verification: SQLite/API lifecycle, restore schema and access invalidation,
  PostgreSQL parity contract, and desktop/mobile Chromium workflow are retained.

## CP-09 Privacy rights operations

- Migration: `071_data_subject_request_governance`
- Operations: owners register, verify, assess, extend, approve, and export
  data-subject requests against current client and worker records.
- Safety: full identity-document copies are prohibited, disclosure and change actions
  require source-current independent approval, and erasure is represented only as
  blocker-aware partial pseudonymisation.
- Processing: restriction and direct-marketing objections prevent relevant new
  opportunity, assignment, communication, and portal activity.
- Recovery: export, backup validation, SQLite-to-PostgreSQL migration, diagnostics,
  and Windows smoke checks retain or verify the privacy register and migration.
- External boundary: Contractor.AI does not deliver exports, decide legal exceptions,
  or claim that retained contractual, financial, safety, or audit history is erased.

## Resume procedure

1. Read the newest user request and `git status --short`.
2. Read `FINAL_VERIFICATION_REPORT.md` and verify its revision matches `HEAD`.
3. Run `npm run verify:release` and the narrow failing test before changing code.
4. Preserve local data and user changes. Never reset or delete runtime evidence.
5. Keep real external actions blocked unless provider verification was explicitly
   completed after this checkpoint.
