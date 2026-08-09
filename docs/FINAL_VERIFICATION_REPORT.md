# Final Verification Report

Report date: 2026-08-09
Release candidate: `1.1.0`
Starting revision: `1c084d5fe30acd2068ae8408078c0769d137a765`
Release revision: the Git commit containing this report; record the resulting SHA
in the release or deployment record.

## Scope

This report verifies the local-first release candidate and repository delivery
contract. It does not attest to credentials, contracts, infrastructure, or legal
decisions outside this repository.

## Automated results

| Gate | Result | Evidence |
| --- | --- | --- |
| Lint | Passed | `npm run lint` |
| Dependency audit | Passed | `npm audit --audit-level=high`: 0 vulnerabilities |
| Release contract | Passed | `npm run verify:release`: 52 canonical paths, 12 retired paths, 16 hosted keys, 306 canonical source files; generated release/runtime/artifact directories excluded |
| Node tests | Passed | `npm test`: 517 tests, 482 passed, 35 PostgreSQL/environment skips, 0 failed, 247.35 s on a busy Windows host |
| Production build | Passed | `npm run build`: main application JS 524.32 kB and CSS 269.21 kB before gzip; managed Team access loads separately as 10.98 kB JS |
| Bundle budget | Passed | `npm run verify:bundle`: 358,551 total gzip bytes across 32 assets |
| Production-scale ledger | Passed | Node 22.23.2: 5,000 jobs, 20,000 tasks, 2,500 opportunities and 25,000 audit events seeded in 1,171.25 ms; cold start 263.14 ms; reopen 4.74 ms; dashboard p95 492.55 ms; intake p95 45.20 ms; audit verification 284.64 ms; all thresholds passed |
| Browser tests | Passed | `npm run test:browser`: 82 Playwright Chromium workflows in 21 isolated batches, 485.5 s |
| Container runtime | Passed | `npm run test:container`: non-root, read-only, loopback, authentication, SQLite volume persistence, graceful shutdown and migration 070 smoke |
| Local runtime | Passed | Rebuilt standalone is ready at `127.0.0.1:4175` against the retained local ledger; migration 070 is current, zero migrations are pending, public readiness returns 200, and the owner register contains no credential material |
| Windows standalone | Passed | `npm run test:windows-package`: bundled Node 22.23.2 x64 runtime passed authenticated isolated-profile startup, migration 070/zero pending, redacted owner register, read-only HAI manifest, credential-safe logs, shutdown and fixture cleanup |
| PostgreSQL parity | CI service gate | The migration 070 managed-account lifecycle and shared ledger contract tests are present; 35 PostgreSQL/environment tests were skipped without a local PostgreSQL service |

## Manual results

| Check | Result |
| --- | --- |
| Desktop owner critical-path rendering | Passed in automated Chromium workflow suite |
| Mobile field workflow rendering | Passed in automated Chromium workflow suite |
| Four-step owner onboarding | Passed from a fresh ledger at 390x844 through persistent server readiness and retained desktop Operations values |
| Safety stop visible and controls disabled | Passed in automated Chromium and Node tests |
| Support bundle and doctor | Passed against an isolated local production runtime |
| Local backup/restore UX | Passed in browser and backend contract tests |
| Governed framework lifecycle | Passed across catalog, 23 family playbooks, guarded starters, API, SQLite, restore, export, HAI, desktop and mobile tests |
| Material, safety, permit and LMRA load races | Passed with job-scoped sequence guards and disabled form controls |
| In-app Browser QA | Passed for Team access creation, scoped field-worker access, key rotation, deactivation and responsive layout with no console errors; automated Chromium remains the retained authority |
| Responsive evidence | Desktop and 720 CSS-pixel mobile geometry were inspected in the in-app browser; 82 automated workflows retain the repeatable interaction evidence |

## Confirmed limitations

- No real external messaging, accounting, calendar, mapping, banking, Peppol, or AI
  provider has been enabled by this repository-only pass.
- EU hosted production remains blocked until an operator supplies and verifies the
  provider, region, DPA, ingress, database, object storage, backup, retention, and
  recovery requirements described in `EU_HOSTING.md`.
- Full bilingual NL/EN UI, universal autosave/pagination, and dedicated component
  tests remain partial.
- The ngrok launcher and fail-closed tests are complete, but no live tunnel was
  opened because no `NGROK_AUTHTOKEN` was available.
- The HAI connector is read-only, source-compatible, exportable, and covered by
  contract tests. It was not executed against a live HAI deployment and has no
  authority to mutate Contractor.AI records.
- The product supports compliance evidence and review gates but makes no legal or
  certification claim.

The performance gate retains a disposable deterministic production-scale fixture,
historical-search and full-aggregate correctness checks, resource and latency
thresholds, and a CI report artifact. The current packaged Node 22 run completed
the representative dashboard at 492.55 ms p95 while preserving the prior query
and assembly optimizations.

The publication record must add the pushed commit SHA and GitHub Actions run URL.
No repository-only test can replace provider, infrastructure, DPA, recovery, or
independent operator acceptance evidence.
