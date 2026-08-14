# Technical Audit

Audit date: 2026-08-09
Starting branch: `main`
Starting revision: `d1a89fbc73be714b6cb05bb7fbf554309c3387ea`

## Executive conclusion

Contractor.AI is a mature local-first contractor operating ledger, not a greenfield
prototype. The canonical product is a Node 22 Express service, a React/Vite client,
SQLite for local operation, PostgreSQL for hosted operation, and local or private
S3-compatible evidence storage. The current audit found 381 declared HTTP routes,
72 append-only migrations, 163 Node test files, 63 browser spec files, and 86
unique literal API path prefixes in the main dashboard, plus dynamic child-component calls.

The prompt's 116 phases are primarily a production-readiness method. The practical
contractor core is already represented: qualification, bid/no-bid, site survey,
takeoff and rate build-up, commercial scope, risk, variations, crew capacity,
Last Planner, daily cycles, 5S, LMRA, installation quality, photo evidence, project
controls, procurement, finance handoffs, handover, feedback, and scorecards.

This pass closes five material control gaps: a durable autonomous-work safety stop,
owner-only privacy-minimized diagnostics, hosted retention-policy enforcement, and
first-run business-identity visibility, plus source-current backup-verified QA
maintenance. It also delivers the portable Windows
runtime, loopback-only ngrok launcher, maintained-parser-compatible read-only HAI connector, compressed and
budgeted production assets, isolated browser runner, phase evidence, and refreshed
dependency lockfile.

The governed framework pass adds the complete 23-family source inventory as a
deterministic checked-in catalog, migration 069, role-scoped APIs, immutable
implementation revisions, backup/export/diagnostic coverage, PostgreSQL parity,
due-review command/HAI integration, and a lazy-loaded searchable Performance
workspace. This is a governed method register, not 671 separate certification or
external-provider engines.

The HAI connector now also has an owner-only local publication lifecycle. It
requires an absolute configured path, atomically replaces the bounded feed,
validates the file after writing, and exposes checksummed status without granting
execution or external-commitment authority.

## Runtime map

| Layer | Canonical implementation | Boundary |
| --- | --- | --- |
| Web UI | `App.jsx`, `ClientPortal.jsx`, `components/` | React renders data returned by APIs; no HTML-string event handlers |
| HTTP API | `server.js` | Authentication, authorization, validation, rate limits, readiness, static production output |
| Domain ledger | `operating-ledger.js` | Transactions, invariants, state changes, audit chain, idempotency |
| Local database | SQLite through the ledger adapter | Default local-first persistence |
| Hosted database | `postgres-sync-database.js`, `postgres-sync-worker.js` | PostgreSQL with TLS and migration locking |
| Evidence | `evidence-storage.js` | Local private files or EU S3-compatible object storage |
| Workers | in-process durable scheduler and leases | Ledger-only drafts/checks; no external commitments |
| Delivery | `Dockerfile`, hosted Compose, CI | Node 22, non-root/read-only container controls |

## Findings and disposition

### Closed in this release

1. Autonomous work lacked a single durable owner stop. Migration 068 adds a
   revisioned, audit-backed control. Scheduled cycles and command application now
   return `automation_suspended` while dry-run diagnosis stays possible.
2. Diagnostics were fragmented and could tempt operators to send raw logs. The
   support bundle exposes version, release id, readiness, migrations, aggregate
   counts, integrity, and control state only. It excludes operational records and
   secrets. `npm run doctor` consumes that contract.
3. Hosted startup required a DPA and backup policy but did not require the chosen
   retention schedule to be identified. Hosted mode now fails closed without
   `CONTRACTOR_AI_RETENTION_POLICY_REFERENCE`.
4. Owner business identity could remain incomplete without a clear first action.
   The Today view now directs the owner to the retained Operations identity form.
5. The broad debug projection was accessible to every authenticated role. It is
   now owner-only.
6. Published dependency advisories in the lockfile were resolved without changing
   the application contract.
7. Concurrent job changes could let stale material, safety, permit, LMRA,
   environmental, expense, or daily-cycle responses overwrite a newer selection.
   Job-scoped sequence guards and native disabled loading controls now close those
   races, including programmatic browser interaction during loading.
8. The previous browser runner reused runtime state between specs. It now discovers
   all 101 tests from the Playwright AST and runs bounded isolated batches against
   separate ports and databases after one production build.
9. The broad framework inventory was documentation-only. Migration 069 and the
   framework workspace now retain every family membership and provide scoped,
   replay-safe, checksum-protected implementation records with due-review triage.
10. Large-ledger behavior had only bounded-query assumptions. A deterministic
    63,500-row benchmark now verifies full historical search and pipeline totals,
    audit integrity, disk/memory use, and p50/p95 startup, read, dashboard, and
    canonical-write thresholds in Node 22 and CI. Profiling also removed irrelevant
    full job-detail assembly from unassigned crew and ineligible handover queues.
11. Accessibility evidence relied on semantic spot checks. A pinned axe browser
    gate now covers sign-in, every primary workspace, representative dialogs,
    mobile navigation, and the client portal at mobile and desktop widths. Shared
    compact-text palettes were corrected wherever the selected WCAG A/AA rules
    identified insufficient contrast.
12. The owner automation stop used browser-native prompt and confirmation surfaces,
    which hid retained decision context and provided weak validation feedback. A
    lazy-loaded, focus-trapped decision dialog now retains the reason, requires an
    explicit acknowledgement, restores initiating focus, and is covered across
    API blocking, axe, keyboard, desktop, and mobile behavior.
13. QA cleanup used the final browser-native confirmation and built its archive set
    through bounded list methods, allowing eligible records beyond the list limit
    to remain active. Operations now obtains a complete deterministic preview,
    requires a source-current plan hash and retained reason, independently verifies
    the recovery package, and performs approval rejection plus archive/retirement
    in one transaction. Empty and changed plans fail without partial mutation.
14. Request-body actor labels were replaced at the parser boundary, but explicit
    route fallbacks still read the bound body field and cloned bodies could lose
    its non-enumerable value. All 164 explicit mutation sites now consume the
    canonical trusted request principal directly, and a release source guard plus
    API persistence tests prevent body-derived audit identities from returning.
15. An archived-work-permit regression used a 500 ms live expiry window and a
    600 ms sleep, which failed under full-suite load before approval could finish.
    Permit creation, readiness, and approval expiry now use the ledger's injectable
    clock consistently, preserving strict expiry rejection with deterministic tests.
16. Several governed records still preferred submitted `createdBy`, `submittedBy`,
    `completedBy`, `releasedBy`, or `reviewedBy` labels over the trusted caller.
    Those records now retain the canonical operator principal, the release scanner
    rejects submitted-first operational provenance, and NCR closure separately
    retains its named verifier plus a source-hashed authenticated verifier principal
    that cannot approve its own closure.
17. Finance readiness exposed English-only job-costing and cost-to-complete evidence
    in an otherwise bilingual practical core. Controlled metrics, statuses, actions,
    cost-code tables, source-review warnings, history, policy text, and accessible
    labels now follow the retained operator locale. Structured warning counts and
    billing milestone sequence data remove presentation parsing, while operator-entered
    budget, time, expense, and supplier evidence remains verbatim. The scrollable
    cost table is keyboard focusable and compact summary contrast now passes axe.
18. Tender comparison and approved purchasing remained English-only inside the
    bilingual operator shell. Bid-package search, filters, comparison, preferred
    selection, purchasing commitments, immutable purchase-order packages, and
    verified provider receipts now follow the retained operator locale without
    translating retained names, scope, rationale, or evidence. The end-to-end Dutch
    flow proves approval and provider-receipt boundaries, reload persistence,
    English round trip, mobile containment, and axe-clean procurement contrast.
19. Parent owner-administration surfaces remained English-only and three form
    patterns were invalid under current Chromium Unicode-set rules. Business
    onboarding/identity, managed team access, autonomous safety, and QA archive
    maintenance now follow the retained locale without changing canonical roles,
    statuses, reasons, confirmation phrases, organization evidence, or access-key
    secrecy. The production-browser journey also closed three metadata/step-label
    contrast defects and proves exact API evidence through an English round trip.

### Residual technical debt

1. `operating-ledger.js`, `server.js`, and `App.jsx` remain large modules. They are
   stable but expensive to review. Split by domain only with contract tests around
   every extracted boundary; a speculative rewrite would increase release risk.
2. The UI has broad browser coverage and a dedicated component-unit gate, but the
   focused component inventory should grow as large domain components are split.
3. Forms have validation, idempotency, bounded central draft recovery, and field
   offline queues, but component-internal recovery is not universal. Offline
   queues remain intentionally narrower and explicit.
4. Pagination and advanced filters are not uniform across all long-lived lists.
5. Per-principal operator language and token-scoped client-portal language are
   retained in the ledger. The shell, client portal, Performance Scorecard, and
   Framework Register are bilingual and formatting follows the selected locale.
   Owner onboarding/identity, managed team access, autonomous safety, QA archive
   maintenance, workforce directory, qualification evidence, availability,
   governed work permits, job setup coverage, critical-path work planning, NCR,
   field risk, field assurance, tender comparison, purchasing, job-costing,
   cost-code review, cost-to-complete, and finance-readiness controls are also
   bilingual, but remaining specialist operator workspace copy is not yet fully
   translated.
6. Legal retention periods and data-subject erasure decisions remain operator and
   counsel responsibilities. The application archives and exports; it does not
   silently delete immutable commercial or audit evidence.

## External blockers

- Real email, calendar, mapping, accounting, Peppol, banking, and AI provider
  execution needs separately verified credentials, contractual authority, and
  provider-specific acceptance tests. No fallback credential or fake delivery is
  enabled.
- EU production requires an operator-selected provider and region, signed DPA,
  HTTPS ingress, managed PostgreSQL, private EU object storage, backup/PITR,
  retention policy, and a completed recovery exercise.
- Regulatory and standards references are workflow aids, not legal certification.
  Wkb, AVG/GDPR, tax, safety, energy, and contract compliance require qualified
  human review for the concrete organization and project.

## Architecture decision

Keep one runtime and one ledger contract. Preserve SQLite for local work and use
PostgreSQL plus private EU object storage for production. Keep external side effects
approval-gated and provider-verified. Expand domain capability behind the existing
API and audit boundaries instead of reintroducing mock dashboards, duplicate
databases, or unrestricted autonomous send paths.
