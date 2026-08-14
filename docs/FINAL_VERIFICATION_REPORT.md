# Final Verification Report

Report date: 2026-08-14
Release candidate: `1.1.0`
Starting revision: `7b6b1a40b44896fc0f29e31eadd100dc95e6475c`
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
| Dependency audit | Passed | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities |
| Release contract | Passed | `npm run verify:release`: 67 canonical paths, 12 retired paths, 16 hosted keys, 338 canonical source files; generated release/runtime/artifact directories excluded |
| HAI input contract | Passed | Native verifier produced the checksummed `accountfeed.GenericItem` review-only fixture with `canExecute=false`; a live HAI parser/account-feed sync was not configured for this run |
| Frontend tests | Passed | Vitest 4.1.10 with Testing Library: 3 files, 10 locale/component tests, 0 failed |
| Node tests | Passed | Isolated suite: 535 tests, 499 passed, 36 PostgreSQL/environment skips, 0 failed, 70.1 s |
| Production build | Passed | `npm run build`: main application JS 544.77 kB and CSS 275.07 kB before gzip; the base locale remains 12.79 kB JS and the expanded 229.26 kB specialist operator catalog is loaded only when Dutch is active; client portal is 24.43 kB JS/10.19 kB CSS and job workspace controls are 241.70 kB JS |
| Bundle budget | Passed | `npm run verify:bundle`: largest JS 544,766 bytes, largest CSS 275,070 bytes, and 455,338 total gzip bytes across 39 assets; all budgets passed |
| Production-scale ledger | Passed | The retained deterministic production profile passed its correctness/resource/latency thresholds: dashboard p95 422.59 ms, canonical intake p95 47.81 ms, startup 230.67 ms, reopen 4.79 ms, and audit verification p95 242.43 ms. |
| Browser tests | Passed | All 99 Playwright Chromium workflows passed on current source in 25 bounded isolated batches in 498.2 s |
| Accessibility gate | Passed | Pinned `@axe-core/playwright` 4.12.1 scanned production sign-in, all twelve owner workspaces, representative dialogs, mobile navigation, and mobile/desktop client portal surfaces with zero selected WCAG A/AA violations and no rule or component exclusions |
| Container runtime | Passed | `npm run test:container`: non-root, read-only, loopback, authentication, SQLite volume persistence, restart persistence, graceful shutdown and migration 072 smoke |
| Local runtime | Passed | Node and browser gates each served the current production build from isolated local runtimes; public readiness, authenticated session, persistence, and graceful shutdown probes passed |
| Windows standalone | Passed | A running preview kept its bundled Node executable locked; the builder preserved Node 22.23.2, refreshed the remaining package, then `npm run test:windows-package` passed authenticated isolated-profile startup, migration 072/zero pending, redacted owner register, available privacy register, and read-only `accountfeed.GenericItem` HAI contract |
| PostgreSQL parity | CI service gate | Migration 072 operator preferences and the shared ledger contract tests are present; 36 PostgreSQL/environment tests were skipped without local provider services |

## Manual results

| Check | Result |
| --- | --- |
| Desktop owner critical-path rendering | Passed in automated Chromium workflow suite |
| Mobile field workflow rendering | Passed in automated Chromium workflow suite |
| Four-step owner onboarding | Passed in Dutch from a fresh ledger at 390x844 through persistent server readiness, exact API identity, retained desktop Operations values, and an English round trip |
| Safety stop visible and controls disabled | Passed in automated Chromium and Node tests; packaged UI verifies focused heading, decision context, disabled incomplete submission, Escape close, and initiating-focus restoration |
| Support bundle and doctor | Passed against an isolated local production runtime |
| Local backup/restore UX | Passed in browser and backend contract tests |
| QA/demo maintenance | Passed for localized preview, complete unbounded selection, deterministic plan hash, stale/empty rejection, verified backup, atomic archive/retirement and approval rejection, retained non-QA records, audit reason/hash, successful focus restoration, and responsive empty state |
| Managed team access | Passed for localized owner-only account creation, one-time key presentation, rotation, immediate session revocation, deactivation, API redaction, canonical role/status retention, and mobile containment |
| Governed framework lifecycle | Passed across catalog, 23 family playbooks, guarded starters, API, SQLite, restore, export, HAI, desktop and mobile tests |
| Privacy rights lifecycle | Passed for request registration, minimal identity reference, deadline extension, source-current assessment, independent approval, restriction/objection guards, rectification, partial pseudonymisation, private JSON export, recovery, and desktop/mobile layout |
| Material, safety, permit and LMRA load races | Passed with job-scoped sequence guards and disabled form controls |
| Audit actor integrity | Passed for authenticated role principals, scoped client portal identity, and local `local:owner`; all explicit mutation sites plus 65 former workflow-label fallbacks consume the trusted principal directly. Approval and authoritative operational provenance preserve that principal through retained decisions, downstream releases, chained history, and separation-of-duty checks. NCR closure retains both named and authenticated verifier identities and rejects self-approval. The release contract rejects body-derived actors, fallback routes, and submitted-first approval or operational principals |
| Work-permit timing integrity | Passed with creation, readiness, and approval expiry bound to the injected ledger clock; deterministic expiry tests retain fail-closed approval behavior without wall-clock sleeps |
| Draft recovery | Passed for reload restoration, operator isolation, portal-token fingerprinting, expiry/size bounds, secret/file exclusion, logout and intentional-close cleanup, no implicit ledger write, and explicit job-workspace navigation |
| In-app Browser QA | Passed against the current built runtime: persisted NL shell rendering, localized currency, compact navigation, no horizontal overflow, and a clean inspected error log; business identity/onboarding, managed team access, autonomous safety, QA maintenance, ICP/service-area, bid/no-bid, WBS/quantity takeoff, labour-burden/overhead/unit-rate estimating, commercial scope/allowances, project risk/premortem, fixed-price-versus-regie decisions, estimates and formal variations, job setup coverage, critical-path work planning, crew-capacity/two-week planning, daily start/EOD reporting, production baseline/output/reversal, regiewerk quantity/acknowledgement/conversion, Last Planner, 5S, LMRA, installation/QC inspections, before/during/after photo evidence, NCRs, field observations/incidents, field assurance review, punch/warranty/aftercare/feedback closeout, client-success handover, and 13-week cash-flow controls render in Dutch. Retained operator evidence remains verbatim across locale changes, while the complete portal, Performance Scorecard, Framework Register, site-survey, and practical-core persistence flows passed in Playwright. |
| In-app Browser draft QA | Passed against the current built runtime: an unfinished opportunity restored exact values after reload, an intentional close cleared it, and no visible error state remained |
| Responsive evidence | Desktop and narrow-screen geometry was inspected in prior in-app browser passes; owner administration, job summary, field-assurance, finance, procurement, and equipment workspaces retain exact mobile containment with localized label wrapping, and 99 automated workflows retain repeatable desktop/mobile interaction evidence. In-app local navigation remains blocked by Browser URL policy in this environment; the isolated production-browser harness passed the same built application. |

## Confirmed limitations

- No real external messaging, accounting, calendar, mapping, banking, Peppol, or AI
  provider has been enabled by this repository-only pass.
- EU hosted production remains blocked until an operator supplies and verifies the
  provider, region, DPA, ingress, database, object storage, backup, retention, and
  recovery requirements described in `EU_HOSTING.md`.
- The operator shell, complete client portal, Performance Scorecard, Framework
  Register, ICP/service-area, bid/no-bid, site-survey, WBS/quantity takeoff,
  labour-burden/overhead/unit-rate estimating, commercial scope/allowances,
  project risk/premortem, fixed-price-versus-regie decisions, estimates,
  quote acceptance, formal variations, job setup coverage, critical-path work
  planning, crew-capacity/two-week planning, daily
  start/EOD reporting, production baseline/output/reversal, regiewerk
  quantity/acknowledgement/conversion, Last Planner, 5S, LMRA, installation/QC
  inspections, before/during/after photo evidence, NCRs, field observations and
  incidents, assurance review, punch/warranty/aftercare/feedback closeout,
  client-success handover, job costing, cost-code review, cost-to-complete,
  source-linked forecast warnings, finance readiness, 13-week cash-flow controls,
  bid-package comparison, preferred-bidder selection, purchasing commitments,
  immutable purchase-order packages, verified provider receipts, business
  identity/onboarding, managed team access, autonomous safety control, QA archive
  maintenance, equipment
  registration, inspection, maintenance, physical custody, quarantine return,
  and approval-gated retirement now have
  persisted NL/EN presentation with locale-aware dates, numbers, and currency.
  Translation of the remaining specialist operator workspaces, universal
  component-internal draft recovery, and uniform pagination remain partial.
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
representative dashboard at 422.59 ms p95 and a canonical intake at 47.81 ms p95
while preserving the prior query and assembly optimizations.

The publication record must add the pushed commit SHA and GitHub Actions run URL.
No repository-only test can replace provider, infrastructure, DPA, recovery, or
independent operator acceptance evidence.
