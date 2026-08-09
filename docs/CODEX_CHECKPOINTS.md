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

## Resume procedure

1. Read the newest user request and `git status --short`.
2. Read `FINAL_VERIFICATION_REPORT.md` and verify its revision matches `HEAD`.
3. Run `npm run verify:release` and the narrow failing test before changing code.
4. Preserve local data and user changes. Never reset or delete runtime evidence.
5. Keep real external actions blocked unless provider verification was explicitly
   completed after this checkpoint.
