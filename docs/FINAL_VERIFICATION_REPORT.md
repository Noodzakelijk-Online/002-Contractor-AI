# Final Verification Report

Report date: 2026-08-09
Release candidate: `1.1.0`
Starting revision: `d1a89fbc73be714b6cb05bb7fbf554309c3387ea`
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
| Release contract | Passed | `npm run verify:release`: 50 canonical paths, 12 retired paths, 16 hosted keys, 302 canonical source files; generated release/runtime/artifact directories excluded |
| Node tests | Passed | `npm test`: 512 tests, 478 passed, 34 skipped, 0 failed, 215.5 s on a busy Windows host |
| Production build | Passed | `npm run build`: main application JS 523.76 kB and CSS 265.23 kB before gzip; onboarding loads separately as 10.20 kB JS and 5.02 kB CSS |
| Bundle budget | Passed | `npm run verify:bundle`: 354,136 total gzip bytes across 31 assets |
| Production-scale ledger | Passed | Node 22.23.2: deterministic 63,500-row fixture in 1.51 s; dashboard p95 620.83 ms; canonical intake p95 86.24 ms; 25,000-event audit verification 352.02 ms; 37 MiB DB and all thresholds passed |
| Browser tests | Passed | `npm run test:browser`: 81 Playwright Chromium tests in 21 isolated batches, 555.4 s |
| Container runtime | Passed | `npm run test:container`: non-root, read-only, loopback, auth, persistence, shutdown and migration 069 smoke |
| Runtime doctor | Passed | Latest local runtime returned ready configuration, verified DB/storage, migration 069, zero pending migrations, ledger/audit integrity, support bundle v1 and no owner key in startup logs |
| Windows standalone | Passed | Rebuilt Node 22.23.2 x64 package; authenticated readiness, migration 069/zero pending, 23-family/671-framework catalog, empty-array HAI feed, and no owner key in logs verified at `127.0.0.1:4175` |
| PostgreSQL parity | CI service gate | Contract tests are present; 34 environment-dependent tests were skipped without a local PostgreSQL service |

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
| In-app Browser attachment | Not available: the browser webview repeatedly failed to attach; the release suite used real Playwright Chromium instead |
| Screenshot evidence | Temporary 1280x900 and 390x844 captures confirmed no horizontal overflow or runtime errors; automated assertions remain the retained release evidence |

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

The performance pass adds a disposable deterministic 63,500-row release fixture,
historical-search and full-aggregate correctness checks, retained resource and
latency thresholds, and a CI report artifact. Profiling reduced the representative
dashboard p95 from 5,951.57 ms to 620.83 ms on the packaged Node 22 runtime by
excluding unassigned crew and ineligible handover records before full job-detail
assembly.

The publication record must add the pushed commit SHA and GitHub Actions run URL.
No repository-only test can replace provider, infrastructure, DPA, recovery, or
independent operator acceptance evidence.
