# Final Verification Report

Report date: 2026-08-09
Release candidate: `1.1.0`
Starting revision: `0326813f214a1ea38771566213ed645421b53f45`
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
| Release contract | Passed | `npm run verify:release`: 61 canonical paths, 12 retired paths, 16 hosted keys, 320 canonical source files; generated release/runtime/artifact directories excluded |
| HAI input contract | Passed | Native verifier passed; maintained HAI `ParseGenericFeed` accepted the generated fixture in an isolated Docker Go runtime and derived read-only `review_document` work |
| Node tests | Passed | `npm test`: 530 tests, 494 passed, 36 PostgreSQL/environment skips, 0 failed, 317.1 s |
| Production build | Passed | `npm run build`: main application JS 526.22 kB and CSS 274.38 kB before gzip; the automation decision dialog loads separately as 4.38 kB JS and 2.03 kB CSS, and QA maintenance as 5.46 kB JS and 2.46 kB CSS |
| Bundle budget | Passed | `npm run verify:bundle`: 370,168 total gzip bytes across 37 assets |
| Production-scale ledger | Passed | Deterministic 63,500-row production profile: seed 2,303.50 ms; cold start 1,673.14 ms; reopen 4.70 ms; dashboard p95 364.01 ms; intake p95 53.97 ms; audit verification 191.81 ms; all correctness, resource, response-size, and latency thresholds passed |
| Browser tests | Passed | All 89 Playwright Chromium workflows passed on current source in 23 bounded isolated batches in 621.4 s |
| Accessibility gate | Passed | Pinned `@axe-core/playwright` 4.12.1 scanned production sign-in, all twelve owner workspaces, representative dialogs, mobile navigation, and mobile/desktop client portal surfaces with zero selected WCAG A/AA violations and no rule or component exclusions |
| Container runtime | Passed | `npm run test:container`: non-root, read-only, loopback, authentication, SQLite volume persistence, restart-persistent session, graceful shutdown and migration 071 smoke |
| Local runtime | Passed | Node and browser gates each served the current production build from isolated local runtimes; public readiness, authenticated session, persistence, and graceful shutdown probes passed |
| Windows standalone | Passed | `npm run test:windows-package`: bundled Node 22.23.2 x64 runtime passed authenticated isolated-profile startup, migration 071/zero pending, redacted owner register, available privacy register, `accountfeed.GenericItem` HAI manifest, credential-safe logs, shutdown and fixture cleanup |
| PostgreSQL parity | CI service gate | The migration 071 privacy lifecycle and shared ledger contract tests are present; 36 PostgreSQL/environment tests were skipped without local provider services |

## Manual results

| Check | Result |
| --- | --- |
| Desktop owner critical-path rendering | Passed in automated Chromium workflow suite |
| Mobile field workflow rendering | Passed in automated Chromium workflow suite |
| Four-step owner onboarding | Passed from a fresh ledger at 390x844 through persistent server readiness and retained desktop Operations values |
| Safety stop visible and controls disabled | Passed in automated Chromium and Node tests; packaged UI verifies focused heading, decision context, disabled incomplete submission, Escape close, and initiating-focus restoration |
| Support bundle and doctor | Passed against an isolated local production runtime |
| Local backup/restore UX | Passed in browser and backend contract tests |
| QA/demo maintenance | Passed for complete unbounded preview, deterministic plan hash, stale/empty rejection, verified backup, atomic archive/retirement and approval rejection, retained non-QA records, audit reason/hash, successful focus restoration, and responsive empty state |
| Governed framework lifecycle | Passed across catalog, 23 family playbooks, guarded starters, API, SQLite, restore, export, HAI, desktop and mobile tests |
| Privacy rights lifecycle | Passed for request registration, minimal identity reference, deadline extension, source-current assessment, independent approval, restriction/objection guards, rectification, partial pseudonymisation, private JSON export, recovery, and desktop/mobile layout |
| Material, safety, permit and LMRA load races | Passed with job-scoped sequence guards and disabled form controls |
| Audit actor integrity | Passed for authenticated role principals, scoped client portal identity, and local `local:owner`; all explicit mutation sites plus 65 former workflow-label fallbacks consume the trusted principal directly. Approval requester/resolver fields preserve that principal through retained decisions, downstream releases, chained history, and separation-of-duty checks. The release contract rejects body-derived actors, fallback routes, and submitted-first approval principals |
| Work-permit timing integrity | Passed with creation, readiness, and approval expiry bound to the injected ledger clock; deterministic expiry tests retain fail-closed approval behavior without wall-clock sleeps |
| In-app Browser QA | Passed against the current built runtime: Operations and the QA-maintenance dialog rendered exact counts/samples, disabled incomplete submission, exact-phrase activation, verified-backup completion notice, responsive empty state, heading focus, Escape restoration, and no page/dialog overflow; the inspected error/warning log was clean before interaction |
| Responsive evidence | Desktop and narrow-screen QA-maintenance geometry was inspected in the in-app browser; 89 automated workflows retain repeatable desktop/mobile interaction evidence |

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
- The HAI connector is read-only, exportable, and accepted by the maintained HAI
  generic-feed parser. A configured HAI account-feed sync and owner mapping were
  not available for live deployment acceptance; the connector has no authority
  to mutate Contractor.AI records.
- The product supports compliance evidence and review gates but makes no legal or
  certification claim.
- Automated accessibility checks do not replace representative keyboard,
  screen-reader, zoom/reflow, or Windows High Contrast user acceptance.

The performance gate retains a disposable deterministic production-scale fixture,
historical-search and full-aggregate correctness checks, resource and latency
thresholds, and a CI report artifact. The current production profile completed the
representative dashboard at 364.01 ms p95 and a canonical intake at 53.97 ms p95
while preserving the prior query and assembly optimizations.

The publication record must add the pushed commit SHA and GitHub Actions run URL.
No repository-only test can replace provider, infrastructure, DPA, recovery, or
independent operator acceptance evidence.
