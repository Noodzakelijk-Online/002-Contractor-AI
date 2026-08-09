# Codex Checkpoints

This file is a compact resume boundary. A future implementation pass should verify
the repository rather than treating these statements as current by assumption.

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

## Resume procedure

1. Read the newest user request and `git status --short`.
2. Read `FINAL_VERIFICATION_REPORT.md` and verify its revision matches `HEAD`.
3. Run `npm run verify:release` and the narrow failing test before changing code.
4. Preserve local data and user changes. Never reset or delete runtime evidence.
5. Keep real external actions blocked unless provider verification was explicitly
   completed after this checkpoint.
