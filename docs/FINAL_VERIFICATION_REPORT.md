# Final Verification Report

Report date: 2026-08-09
Release candidate: `1.1.0`
Starting revision: `649344f0448f03331a9a1afae363fe5536f286ed`
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
| Release contract | Passed | `npm run verify:release`: 59 canonical paths, 12 retired paths, 16 hosted keys, 317 canonical source files; generated release/runtime/artifact directories excluded |
| HAI input contract | Passed | Native verifier passed; maintained HAI `ParseGenericFeed` accepted the generated fixture in an isolated Docker Go runtime and derived read-only `review_document` work |
| Node tests | Passed | `npm test`: 525 tests, 489 passed, 36 PostgreSQL/environment skips, 0 failed, 165.1 s |
| Production build | Passed | `npm run build`: main application JS 525.12 kB and CSS 274.38 kB before gzip; the automation decision dialog loads separately as 4.38 kB JS and 2.03 kB CSS |
| Bundle budget | Passed | `npm run verify:bundle`: 367,022 total gzip bytes across 35 assets |
| Production-scale ledger | Passed | Packaged Node 22.23.2 with the deterministic 63,500-row fixture under concurrent host load: seed 5,732.14 ms; cold start 1,129.51 ms; reopen 81.69 ms; dashboard p95 737.43 ms; intake p95 99.09 ms; audit verification 315.43 ms; all thresholds passed |
| Browser tests | Passed with host-contention note | All 88 Playwright Chromium workflows passed on current source across bounded isolated and retained-runtime completion groups. One repeated default 22-batch invocation was interrupted by Chrome `ERR_NO_BUFFER_SPACE` while an unrelated checkout launched more than 20 development servers; the affected Last Planner batch and every remaining workflow passed in isolation afterward. |
| Accessibility gate | Passed | Pinned `@axe-core/playwright` 4.12.1 scanned production sign-in, all twelve owner workspaces, representative dialogs, mobile navigation, and mobile/desktop client portal surfaces with zero selected WCAG A/AA violations and no rule or component exclusions |
| Container runtime | Passed | `npm run test:container`: non-root, read-only, loopback, authentication, SQLite volume persistence, restart-persistent session, graceful shutdown and migration 071 smoke |
| Local runtime | Passed | Rebuilt standalone PID 7600 is ready at `127.0.0.1:4175` against the retained local ledger; migration 071 is current, zero migrations are pending, public readiness returns 200, the retained audit chain is valid, and the live HAI manifest exposes the corrected generic-item contract |
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
| Governed framework lifecycle | Passed across catalog, 23 family playbooks, guarded starters, API, SQLite, restore, export, HAI, desktop and mobile tests |
| Privacy rights lifecycle | Passed for request registration, minimal identity reference, deadline extension, source-current assessment, independent approval, restriction/objection guards, rectification, partial pseudonymisation, private JSON export, recovery, and desktop/mobile layout |
| Material, safety, permit and LMRA load races | Passed with job-scoped sequence guards and disabled form controls |
| In-app Browser QA | Passed against the rebuilt packaged runtime: Operations and the owner safety dialog rendered with the correct landmarks, active-state context, disabled incomplete submission, Escape/focus restoration, desktop containment, and a clean error log; automated Chromium remains the retained authority for mobile and repeatable interaction evidence |
| Responsive evidence | Packaged desktop geometry was inspected in the in-app browser; 88 automated workflows retain repeatable desktop/mobile interaction evidence |

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
thresholds, and a CI report artifact. Under concurrent host load, the packaged
Node 22.23.2 production profile completed the representative dashboard at
737.43 ms p95 while preserving the prior query and assembly optimizations.

The publication record must add the pushed commit SHA and GitHub Actions run URL.
No repository-only test can replace provider, infrastructure, DPA, recovery, or
independent operator acceptance evidence.
