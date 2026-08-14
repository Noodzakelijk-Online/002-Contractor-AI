# UI Action Audit

Audit date: 2026-08-14

The product has one React/Vite operator application and one scoped React client
portal. There is no alternate static dashboard. Actions call the canonical ledger
or operations APIs and expose explicit loading, disabled, empty, and error states.

## Navigation and workflows

| Area | Primary decisions/actions | Audit result |
| --- | --- | --- |
| Sign in | role key login, session recovery, logout | Wired; no browser storage for keys |
| Today | review exceptions, draft internal actions, run dry/apply cycle | Wired; safety-stop aware |
| Leads | create, qualify, assess fit/bid, survey, convert | Wired and persisted |
| Jobs | choose job, inspect lifecycle, scope, risk, changes, closeout | Wired and persisted |
| Planning | schedule, capacity, assignments, constraints, commitments | Wired and persisted |
| Field | assigned work, attendance, daily evidence, safety and quality | Wired; mobile/offline states covered |
| Procurement | bidder/partner, comparison, preferred selection, commitment, immutable PO package, verified receipt, receiving, equipment | Wired and bilingual through approved order delivery; compliance, approval, and provider-receipt gated |
| Finance | job costing, cost-to-complete, forecasts, billing, invoice/credit/payable evidence | Wired and bilingual for the practical-core cost review; no transfer or ledger posting claim |
| Performance | scorecard and governed framework search, method basis, scope, evidence, measures, review and history | Wired and persisted; starters never fabricate evidence and make no method certification claim |
| Approvals | inspect source, approve/reject, follow resulting action | Wired; source changes fail closed |
| Operations | identity, readiness, audit, backup/export/archive/restore | Wired; owner safety, support, and previewed QA-maintenance controls added |
| Client portal | inspect approved job data and submit scoped responses | Wired; token/job/action bounded |

## Enhancements in this release

- A global red safety banner makes suspended autonomous work visible from every
  operator view.
- Today shows an owner-only first-run task when legal/business identity fields are
  incomplete and opens a four-step identity, contact, billing, and readiness flow.
- Every completed setup step is retained in the canonical ledger. The final screen
  uses server readiness, keeps commercial issue gates intact, and remains contained
  at mobile width with keyboard escape, focus cycling, and focus restoration.
- A pinned axe gate blocks release on selected WCAG 2.0/2.1 A/AA and WCAG 2.2 AA
  violations across sign-in, all primary workspaces, representative dialogs,
  mobile navigation, and the client portal at mobile and desktop widths.
- Operations contains one explicit safety-control panel with retained reason display,
  a dedicated owner decision dialog, and privacy-minimized support-bundle download.
- Suspension and resumption require a new reason and explicit acknowledgement in a
  focus-trapped dialog. Escape/cancel restores focus to the initiating control.
- QA/demo maintenance shows the current server-derived archive set before a write,
  requires a reason and exact phrase, reloads stale plans inline, and restores the
  initiating control after cancellation or the post-archive dashboard refresh.
- QA maintenance verifies a local recovery package before one atomic server-side
  archive. It does not delete retained evidence or create an external commitment.
- Autonomous cycle and command-apply actions are disabled and relabelled while
  suspension is active; diagnostic dry run remains available.
- Business identity, material receiving, safety briefing, work permit, LMRA,
  environmental, expense, and daily-cycle forms keep the active job/draft stable
  during background refreshes and disable affected controls while loading.
- Field assurance, NCR, and observation/incident controls now share the retained
  operator locale, preserve operator evidence verbatim, expose localized governed
  actions, and remain contained on narrow field-worker screens.
- Finance readiness now presents cost-code budgets, approved/unreviewed actuals,
  commitments, CTC/EAC/VAC, source warnings, forecasts, and approval-gated actions
  in Dutch or English without rewriting retained cost evidence. Its scrollable table
  is keyboard focusable and axe-clean at desktop and mobile widths.
- Tender comparison and purchasing now present bid-package filters, retained
  returns, preferred selection, commitments, immutable PO packages, and verified
  provider receipts in Dutch or English without rewriting commercial evidence.
  No supplier contact, award, order, payment, or signature is claimed before its
  independent approval and provider evidence boundary.
- The responsive production UI is exercised by 97 isolated Chromium tests across
  desktop, mobile, owner, field-worker, office, approver, and client-portal flows.
- The framework catalog renders 25 bounded rows per page with search, family and
  status filters; create, activation, history, and mobile containment are exercised
  as one production workflow.
- Every framework family exposes its review steps, recommended scope and cadence,
  evidence prompts, measure candidates, and operating safeguards. The optional
  starter fills only missing cadence and measures; evidence remains operator-supplied.

## Interaction standards

- Buttons represent commands; native checkboxes, selectors, date/number fields, and
  compact icon controls are used for their appropriate semantics.
- Stable toolbar/panel dimensions, constrained grids, and responsive breakpoints
  prevent action controls from resizing surrounding content.
- No inline HTML event attributes or runtime HTML-string dashboard rendering are
  used. Generated commercial packages are separate downloadable artifacts.
- Destructive and externally meaningful operations require confirmation, reason,
  retained approval, or verified receipt according to their risk.
- Loading states prevent duplicate submission; server idempotency is still the
  authoritative duplicate control.

## Residual UX work

- The operator shell and complete client portal provide persisted NL/EN switching;
  dates, numbers, and EUR values follow the selected locale. The practical-core
  field assurance, safety, quality, planning, commercial, and closeout chains are
  bilingual, but some specialist operator workspaces still contain English-only
  copy, so application-wide translation remains incomplete.
- General draft autosave is not universal. Field offline capture has a dedicated
  queue; broad silent local caching would need privacy and conflict design.
- Large lists do not all offer the same advanced filters and pagination.
- Team/role settings are environment-administered in production instead of being a
  full identity-provider and invitation UI.

These gaps do not create fake product actions; they are tracked as partial phases
in `GOAL_COMPLETION_MATRIX.md`.
