# UI Action Audit

Audit date: 2026-08-09

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
| Procurement | bidder/partner, commitment, receiving, equipment | Wired with compliance/approval gates |
| Finance | forecasts, billing, invoice/credit/payable evidence | Wired; no transfer or ledger posting claim |
| Performance | scorecard and governed framework search, method basis, scope, evidence, measures, review and history | Wired and persisted; starters never fabricate evidence and make no method certification claim |
| Approvals | inspect source, approve/reject, follow resulting action | Wired; source changes fail closed |
| Operations | identity, readiness, audit, backup/export/archive/restore | Wired; owner safety and support controls added |
| Client portal | inspect approved job data and submit scoped responses | Wired; token/job/action bounded |

## Enhancements in this release

- A global red safety banner makes suspended autonomous work visible from every
  operator view.
- Today shows an owner-only first-run task when legal/business identity fields are
  incomplete and routes directly to the retained Operations form.
- Operations contains one explicit safety-control panel with reason display,
  suspend/resume confirmation, and privacy-minimized support-bundle download.
- Autonomous cycle and command-apply actions are disabled and relabelled while
  suspension is active; diagnostic dry run remains available.
- Business identity, material receiving, safety briefing, work permit, LMRA,
  environmental, expense, and daily-cycle forms keep the active job/draft stable
  during background refreshes and disable affected controls while loading.
- The responsive production UI is exercised by 80 isolated Chromium tests across
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

- Most copy is English. Dutch formats and domain concepts exist, but full NL/EN
  translation and locale switching remain incomplete.
- General draft autosave is not universal. Field offline capture has a dedicated
  queue; broad silent local caching would need privacy and conflict design.
- Large lists do not all offer the same advanced filters and pagination.
- Owner setup is a focused readiness panel rather than a multi-step wizard.
- Team/role settings are environment-administered in production instead of being a
  full identity-provider and invitation UI.
- The safety reason uses a native prompt/confirm sequence. It is accessible and
  functional, but a dedicated focus-trapped dialog is a future polish item.

These gaps do not create fake product actions; they are tracked as partial phases
in `GOAL_COMPLETION_MATRIX.md`.
