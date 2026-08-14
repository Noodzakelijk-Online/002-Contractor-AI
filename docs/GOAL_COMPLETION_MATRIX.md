# Goal Completion Matrix

Status meanings:

- **Implemented**: present in code/docs and covered by a release gate.
- **Partial**: useful capability exists, but the full phase scope or production
  evidence is not complete.
- **Blocked**: requires operator infrastructure, credentials, contracts, or legal
  decisions not present in the repository.
- **N/A**: phase is a reporting instruction rather than product behavior.

No phase is marked complete solely because a document exists. Final automated and
manual evidence is recorded in `FINAL_VERIFICATION_REPORT.md`.

| Phase | Requirement | Status | Repository evidence / remaining gap |
| ---: | --- | --- | --- |
| 000 | Repository integrity and true starting point | Implemented | Clean `main` starting SHA retained in audit/worklog; retired paths guarded by release contract |
| 001 | Complete file and dependency audit | Implemented | Source inventory, dependency audit, release scan; runtime/generated paths excluded |
| 002 | Product definition and user outcome contract | Implemented | README and critical path define the local-first contractor operating outcome |
| 003 | Critical path definition and smoke test | Implemented | `CRITICAL_PATH.md`, workflow integration/browser tests |
| 004 | Architecture decision and current stack validation | Implemented | One Node/Express + React ledger runtime; SQLite local/PostgreSQL hosted decision |
| 005 | Data model, ownership, and persistence design | Implemented | 71 migrations, resource ownership, SQLite/PostgreSQL contracts |
| 006 | Configuration validation and startup guards | Implemented | local/hosted startup readiness tests and fail-closed environment validation |
| 007 | Authentication model and session security | Implemented | signed revocable cookies, independent role keys, login limits, auth tests |
| 008 | Authorization and resource ownership | Implemented | role middleware, job/assignment/portal scoping, owner-only debug/operations |
| 009 | API contract and error envelope | Implemented | ledger routes, stable errors/statuses, replay semantics, API audit |
| 010 | Frontend architecture and navigation model | Implemented | one Vite/React application plus scoped client portal |
| 011 | Core workflow vertical slice | Implemented | opportunity through project, evidence, commercial, handover and finance workflows |
| 012 | External provider reality review | Partial | provider receipts fail closed; real email/accounting/maps/calendar/AI need credentials |
| 013 | Compliance and platform policy boundaries | Partial | explicit non-certification controls; jurisdiction/project legal review remains external |
| 014 | No fake success and no mock production behavior | Implemented | delivery/acceptance/payment/certification states require separate evidence |
| 015 | Storage, files, uploads, and media safety | Implemented | private adapters, signature/checksum/path/ownership controls and tests |
| 016 | Background jobs, schedulers, and workers | Implemented | durable opt-in scheduler, database leases, ledger-only cycle |
| 017 | Idempotency and duplicate action prevention | Implemented | exact replay keys, source identities, hashes and atomic constraints |
| 018 | Rate limits, cooldowns, and provider quotas | Implemented | durable bounded API/login limits; provider action remains disabled until verified |
| 019 | Audit logging and event history | Implemented | transaction-bound SHA-256 chain, direct trusted-principal use across all explicit mutation routes and authoritative operational provenance, source guards against body-derived actors and submitted-first `...By` principals, source-hashed NCR verifier principal, history UI, integrity/readiness checks |
| 020 | User-facing dashboard and next-action design | Implemented | Today exception/command queue, approvals, safety and readiness indicators |
| 021 | Forms, validation, and autosave behavior | Partial | validation/submission states, field offline queue, and bounded operator/client draft recovery for central workflows; component-internal forms are not universally recoverable |
| 022 | Search, filters, sorting, and pagination | Partial | major queues are filterable/bounded; behavior is not uniform across every list |
| 023 | Import and export workflows | Implemented | operational export/validation, backup download, hosted migration and CSV packages |
| 024 | Templates, presets, and reusable user defaults | Partial | all 23 framework families have guarded method playbooks and cadence/measure starters; checklist templates and rate policies exist; user presets are not universal |
| 025 | AI/provider abstraction and deterministic fallback | Partial | deterministic ledger drafting and provider gates; no configured general AI adapter |
| 026 | Human review queue and approval gates | Implemented | approval queue, atomic source-current decisions, rejection recovery |
| 027 | Notifications and reminders | Partial | internal reminders/follow-ups exist; external notifications require verified provider |
| 028 | Privacy controls and data deletion | Partial | approval-gated rights register, restriction/objection guards, export, correction and partial pseudonymisation exist; full legal erasure remains decision-dependent |
| 029 | Security headers and web security | Implemented | CSP/headers, CORS/origin, body limits, proxy validation and tests |
| 030 | Secrets management and credential rotation | Implemented | no fallback secrets, env validation, role-key rotation/revocation guidance |
| 031 | Local development one-command experience | Implemented | `npm install`, build/start plus split API/Vite development commands and isolated browser runner |
| 032 | Docker and deployment readiness | Implemented | multi-stage non-root image, read-only container gate, hosted Compose |
| 033 | Database migrations and rollback safety | Implemented | append-only migrations, locks, backup/restore and environment migration validation |
| 034 | CLI and doctor/self-diagnostic command | Implemented | privacy-minimized `npm run doctor` |
| 035 | Observability, health, and readiness endpoints | Implemented | minimal public health plus authenticated detailed readiness/capabilities |
| 036 | Admin/operator diagnostics | Implemented | integrity, migrations, backups, exports, control and support bundle |
| 037 | Demo mode with explicit labelling | Implemented | QA/demo records are labelled; owner maintenance previews the complete set, rejects stale plans, verifies recovery, and archives atomically |
| 038 | Fake provider lab for tests only | Implemented | test doubles remain under tests; production requires verified allowlisted provider |
| 039 | Test-data factories and fixtures | Implemented | isolated temp data, per-test server/ledger fixtures, QA records |
| 040 | Backend test suite | Implemented | broad Node unit/integration suite across ledger and API contracts |
| 041 | Frontend and component test suite | Implemented | dedicated Vitest/Testing Library behavioral gate plus full browser workflows and source assertions |
| 042 | Worker/job test suite | Implemented | scheduler lease, idempotency, failure and suspension tests |
| 043 | End-to-end workflow tests | Implemented | 90 Playwright operator/client/field/framework/onboarding/team-access/privacy/accessibility/safety/maintenance/recovery flows plus API vertical slices |
| 044 | Acceptance test matrix | Implemented | `ACCEPTANCE_TESTS.md` maps 34 release outcomes |
| 045 | Adversarial break-the-app tests | Implemented | source drift, replay, auth, rate, tamper, malformed evidence and conflict tests |
| 046 | Cross-user isolation tests | Implemented | roles, assignment/resource ownership and portal token boundaries |
| 047 | File safety and path traversal tests | Implemented | evidence, backup, package, upload, symlink/path/checksum cases |
| 048 | Provider failure simulation | Implemented | unavailable/unverified/ambiguous provider states fail closed in tests |
| 049 | Accessibility review | Partial | pinned axe gate reports zero selected WCAG A/AA violations across sign-in, all primary workspaces, representative dialogs, mobile navigation, and the mobile/desktop client portal; independent assistive-technology and user audit remains external |
| 050 | Responsive and browser compatibility | Implemented | 90 desktop/mobile operator, client and field Chromium tests in isolated batches |
| 051 | Performance baseline and indexing | Implemented | bundle budgets plus deterministic 63,500-row Node 22 benchmark, hot-queue indexes, p50/p95/resource thresholds and CI report |
| 052 | Large dataset and pagination testing | Implemented | 5,000 jobs, 20,000 tasks, 2,500 opportunities, 5,000 approvals and 25,000 chained audit events verify bounded lists, historical search and untruncated aggregates |
| 053 | Backup and restore procedures | Implemented | v2 DB/evidence manifests, checksums, validation, session revocation, runbook |
| 054 | Data reconciliation and repair commands | Partial | integrity/reconciliation/restore/migration tools exist; no generic mutation repair CLI |
| 055 | Product analytics local-first design | Implemented | retained contractor scorecard and operating metrics; no forced external telemetry |
| 056 | SaaS readiness without forced billing | Implemented | portable hosted contract with local-first mode; billing is not required |
| 057 | Internationalization and Dutch/English readiness | Partial | persisted per-operator NL/EN preference, locale-aware formatting, complete token-scoped client portal, and bilingual Performance Scorecard, Framework Register, market-fit, bid/no-bid, site-survey, WBS/quantity takeoff, labour burden/overhead/unit-rate estimating, commercial scope/allowances, project risk/premortem, fixed-price-versus-regie decisions, estimates/quotes/acceptance, formal variations, crew-capacity/two-week planning, Last Planner, 5S, LMRA, and 13-week cash-flow controls; remaining specialist workspaces still contain English-only copy |
| 058 | Feature flags and rollout controls | Partial | provider/scheduler/storage controls and owner stop; no generic flag service |
| 059 | Formal state machines | Partial | guarded explicit statuses/transitions across domains; not one central state DSL |
| 060 | Domain model specification | Implemented | migrations, ledger methods, README safety model and API contracts |
| 061 | Data invariants and constraints | Implemented | database constraints plus transactional current-source/lifecycle checks |
| 062 | Pre-action safety review screen | Implemented | approval previews, source evidence, external-action separation and confirmation |
| 063 | Provider credential verification checklist | Implemented | readiness/capabilities, env examples and EU hosting runbook |
| 064 | Threat model and security design review | Implemented | `SECURITY.md` trust boundaries, controls and incident procedure |
| 065 | Privacy impact assessment | Partial | data classes/purpose/minimization/retention risks documented; counsel sign-off external |
| 066 | Supply chain and dependency review | Implemented | lockfile audit at zero known advisories and CI dependency gate |
| 067 | License and third-party service review | Partial | MIT package license and provider boundaries; service terms need operator legal review |
| 068 | CI/CD quality gates | Implemented | lint, audit, release, test, build, axe accessibility, browser and container workflows |
| 069 | Release process, canary, and rollback | Blocked | local gate/runbook implemented; real EU canary/rollback needs selected infrastructure |
| 070 | Operator runbook | Implemented | `OPERATOR_RUNBOOK.md` and `EU_HOSTING.md` |
| 071 | User guide and help system | Partial | README/runbooks and inline states; no comprehensive in-app help center |
| 072 | Troubleshooting guide and error catalog | Implemented | operator diagnostics table, doctor and stable error codes |
| 073 | UI action audit | Implemented | `UI_ACTION_AUDIT.md` maps actions and residual gaps |
| 074 | Backend endpoint usage audit | Implemented | `API_USAGE_AUDIT.md`, route/call-site counts and release assertions |
| 075 | Documentation truthfulness audit | Implemented | limitations, non-certification and pending verification are explicit |
| 076 | Technical debt register | Implemented | technical audit records module size, remaining specialist-workspace i18n, autosave and provider-bound load acceptance debt; qualification, bid decision, site survey, crew planning and cash-flow practical-core controls are now bilingual |
| 077 | Bug hunt log | Implemented | worklog records findings, tests and scope decisions |
| 078 | Red-team review loop one | Implemented | side-effect/provider/source-currentness boundaries rechecked |
| 079 | Red-team review loop two | Implemented | auth/privacy/debug/support boundaries rechecked |
| 080 | Red-team review loop three | Implemented | hosted durability/recovery/retention and operational stop rechecked |
| 081 | Non-technical user simulation | Partial | browser operator flows exist; final independent user acceptance still required |
| 082 | Autonomy-first product review | Implemented | ledger-only drafts, owner stop, approval and verified delivery boundaries |
| 083 | Value review | Implemented | critical path and practical contractor core prioritized over vanity surfaces |
| 084 | Product realism review | Implemented | no fake send/pay/certify states; external prerequisites remain visible |
| 085 | Requirements traceability | Implemented | this phase-by-phase matrix and acceptance mapping |
| 086 | Task graph and dependency map | Implemented | `TASK_GRAPH.md` |
| 087 | Codex worklog and checkpoints | Implemented | `CODEX_WORKLOG.md`, `CODEX_CHECKPOINTS.md` |
| 088 | Context-loss resume safety | Implemented | checkpoint resume procedure and durable repository artifacts |
| 089 | Progressive stabilization gates | Implemented | task graph gates G0-G6 and fail-closed release contract |
| 090 | No vanity work rule | Implemented | runtime/safety/diagnostic/hosted controls prioritized; no marketing page added |
| 091 | Feature-level definition of done | Implemented | acceptance requires persistence, role, replay, UI, test and truthful side-effect state |
| 092 | Fresh-clone dry run | Partial | package/build/container and Node 22 Windows packaging gates emulate clone; external hosted stack not available locally |
| 093 | Manual verification evidence | Partial | automated real-browser, local runtime and Windows package evidence passed; independent operator/provider/hosted evidence remains external |
| 094 | Final no-excuses search | Implemented | release scan covers 61 canonical paths, 12 retired paths, 16 hosted keys and 319 canonical source files; dependency audit reports zero vulnerabilities |
| 095 | Completion matrix | Implemented | this file contains every phase 000-115 |
| 096 | Final verification report | Implemented | report records exact local command, browser, runtime, package and container results plus external boundaries |
| 097 | Final response requirements | N/A | final user response will list revision, tests, limitations, blockers and push state |
| 098 | Post-completion maintenance plan | Implemented | changelog discipline and runbook maintenance schedule |
| 099 | Roadmap and blocked items | Implemented | residual technical debt and external blockers are explicitly listed |
| 100 | Real-provider cleanup and account safety | Blocked | no credentials supplied; product fails closed and retains rotation checklist |
| 101 | Support/debug bundle design | Implemented | owner-only privacy-minimized v1 support bundle and doctor CLI |
| 102 | Data retention and archival policy | Partial | hosted policy reference required and archive/export exist; periods need counsel decision |
| 103 | Migration from prototype to production | Implemented | Python/mock runtimes retired; Node ledger sole runtime and historical 410s guarded |
| 104 | Operator safety stop and emergency controls | Implemented | audited durable suspend/resume with an accessible reason-and-acknowledgement dialog; explicitly not a physical emergency system |
| 105 | User onboarding and first-run wizard | Implemented | owner-only four-step identity, contact, billing and readiness flow persists each step to the canonical ledger and is mobile/browser tested |
| 106 | Role-based settings and team permissions | Implemented | owner-managed named accounts, field scope, one-time hashed keys, rotation/deactivation, session revocation, protected deployment principals, recovery invalidation and desktop/mobile tests |
| 107 | Quality scoring and confidence display | Partial | fit/scorecard/quality/confidence evidence exists but is not universal across predictions |
| 108 | Human decision minimization | Implemented | Today proposes grouped next actions while retaining approval for risky decisions |
| 109 | Exception-based workflow dashboard | Implemented | Today, readiness, approval, dispatch, evidence, finance and compliance exceptions |
| 110 | Safe retries and recovery strategy | Implemented | exact replay, leases, ambiguity gates, backup/restore and reconciliation |
| 111 | Ambiguous external action resolution | Implemented | delivery state requires allowlisted provider receipt; ambiguous attempts do not retry blindly |
| 112 | Versioning and changelog discipline | Implemented | 1.1.0 release and `CHANGELOG.md`; append-only migration numbering |
| 113 | Regression baseline | Implemented | release commands, critical path, acceptance matrix and broad test suite |
| 114 | Maintenance and refactoring review | Partial | debt documented; monolith extraction intentionally deferred behind contract tests |
| 115 | Final human-operator readiness test | Partial | automated desktop/mobile operator workflows passed; independent human, EU and provider acceptance remain external |

## Release interpretation

The local-first product may be released only when the final automated and browser
gates pass. EU-hosted production must remain blocked until phases 069 and 100 and
the external portions of 012, 013, 063, 065, 067, 092, 093, 102, and 115 have
operator-owned evidence. Partial does not mean safe to ignore; it defines the next
bounded improvement or external acceptance step.
