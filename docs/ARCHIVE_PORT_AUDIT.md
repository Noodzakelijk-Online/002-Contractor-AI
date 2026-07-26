# Archive Port Audit

Date: 2026-07-25

## Scope and evidence

The requested review covered both supplied archives. Each source was hashed
before extraction and compared at implementation level against the canonical
Node operating ledger.

| Source | Size | SHA-256 | Inventory |
| --- | ---: | --- | --- |
| `002 _ Contractor.zip` | 11,867,677 bytes | `e1860143cc29708ec6c3d326588a752c25068cec1c8b1461b9d334574dfe12e3` | 436 flat entries: snapshots, research, nested archives, installer sources, generated output, and duplicate TypeScript/Python prototypes. Windows could not materialize several invalid archive names, so the audit used a numerically named safe extraction plus an original-name manifest. No installer or binary was executed. |
| `contractor-ai.zip` | 2,249,267 bytes | `974235c697abf4d6da0af500d0e9d3fcdee2f06fbdf978828dedca1dd10b1313` | 605 entries: a separate React/TypeScript, Node/tRPC, MySQL/Drizzle application plus a duplicate Python self-installer tree. |

Nested copies and generated artifacts were treated as duplicates rather than
independent product evidence. Relevant source modules were read directly; the
old runtime itself was not copied. Of the flat bundle's 406 text/source files,
359 share a basename with a file in the extracted TypeScript prototype. The 47
remaining basenames are primarily research, patch scripts, debugging scripts,
marketing pages, and superseded audit material.

## Verified source findings

| Archive implementation | Finding |
| --- | --- |
| BENG compliance service | The source explicitly describes its BENG calculation as simplified and states that the real NTA 8800 calculation is substantially more complex. It applies hard-coded thresholds and exposes calculated outcomes through the prototype router. Those calculations were not copied. |
| KLIC tracker | The UI declares mock KLIC data. Its add action shows a toast but does not persist a notification or call a provider. |
| Omgevingsloket and permits | The permit service is a rule-based MVP with a TODO for DSO integration after authentication. The Omgevingsloket service uses hard-coded rules and fee estimates rather than a verified government API. |
| MEP and coordination | The generic CPM implementation uses the current time as project start, does not reject cycles, and marks new critical tasks without clearing stale flags. MEP optimization serializes all work using a fixed mechanical-electrical-plumbing order. This is weaker than the canonical dependency graph, cycle rejection, retained schedule source, baseline approval, RFI, submittal, and meeting controls. |
| Offline/PWA | The IndexedDB queue logs each action and immediately marks it synced without sending it to an API. Service-worker background time sync is a placeholder. It has no operator scope, source fingerprint, exact-replay conflict handling, bounded retention, or approval semantics. |
| Time corrections | The prototype changes the original time entry through a public token and auto-approves unanswered requests after 24 hours. The canonical ledger instead keeps approval-backed compensating attendance adjustments, immutable weekly revisions, and checksum-protected handoff files. |
| Process library | Seed scripts contain useful descriptive trade knowledge, but couple directly to the discarded MySQL schema. Canonical job playbooks, versioned inspection templates, site surveys, safety controls, and task plans already provide the governed runtime equivalent. |
| Language context | The NL/EN context is referenced only by its own module, is not wired into the archived application, and the archived Dutch strings contain encoding damage. Client language preference remains retained in the canonical ledger; complete interface localization should be implemented as a separately tested product capability, not represented by this dead context. |
| Supplier prices and procurement | One service explicitly generates randomized simulated supplier quotes. The webshop path scrapes changing HTML and asks an LLM to infer prices, while B2B prices remain unavailable. Fuel and fallback route values are hard-coded. These values are not reliable enough to authorize estimates, purchasing, or savings claims. |
| Country configuration | The flat archive contains hard-coded country settings with stale regulatory labels, incomplete public-holiday rules, and encoding damage. The dashboard save action only waits one second and displays a toast; it does not persist a company setting or alter financial controls. |
| Savings calculator and marketing pages | The calculator hard-codes a monthly AI cost, two hours of operator work, zero lead cost, and zero commission, then presents the result as savings. The landing/persona/demo pages are promotional surfaces rather than governed operating capability. |

## Port decisions

| Archive family | Canonical decision | Current coverage |
| --- | --- | --- |
| BENG and energy labels | Ported | Migration 067 adds immutable, approval-backed energy-performance records. The API and dashboard retain BENG 1, BENG 2, BENG 3, TOjuli, adviser and certified-company identity, NTA 8800 and software versions, EP-Online references, evidence hashes, supersession, and permit-to-completion continuity. Contractor.AI compares operator-retained values and limits only; it does not calculate, certify, register, or submit. |
| KLIC and Omgevingsloket | Partially represented; no provider adapter ported | The existing permit, excavation work-permit, evidence, approval, stop-work, acknowledgement, and handover controls can retain operator-supplied references. There is no claim of a live KLIC, Kadaster, or Omgevingsloket connection, automated statutory filing, or complete regulatory workflow. A provider adapter requires a verified API contract, credentials, role scopes, retention rules, and explicit approval boundary. |
| MEP coordination | Already represented; unsafe prototype logic excluded | Task dependencies, cycle rejection, critical-path calculations, controlled baselines, RFIs, submittals, drawings, meetings, inspections, and subcontractor qualification are canonical. A future model-based clash adapter would require a verified IFC/model source and retained review evidence. |
| Offline field work | Already represented | The canonical operator-scoped IndexedDB outbox supports bounded drafts, exact replay, source fingerprints, retained evidence, conflict handling, and server-side authorization across field workflows. |
| Attendance corrections and timesheets | Already represented | Attendance adjustments are compensating, approval-gated records. Weekly timesheets retain source-current revisions and checksum-protected exports without executing payroll. |
| Work templates | Already represented | Governed job playbooks and versioned inspection templates create linked tasks, materials, safety, quality, survey, and aftercare records without bypassing approvals. |
| Interface localization | Not ported from archive | The archived context is unused and incomplete. Client and evidence language metadata is retained, but a full translated interface remains a distinct, end-to-end capability rather than an archive port. |
| Supplier price discovery | Deliberately excluded | Simulated or inferred prices cannot become estimate or spend evidence. Canonical procurement accepts retained operator/provider evidence and keeps supplier spend approval-gated. A future live adapter needs supplier authorization, provenance, freshness, VAT/unit normalization, and failure semantics. |
| Country configuration | Deliberately excluded | Multi-country tax and regulatory behavior must use current authoritative sources, effective dates, organization scope, and tested accounting rules. Importing the stale display-only object would create false compliance confidence. |
| Savings claims and marketing pages | Deliberately excluded | Unsupported ROI claims and duplicate promotional pages do not belong in the canonical operating application. |
| Recurring work | Already represented | Retained recurring plans create bounded internal job drafts and remain subject to the canonical ledger, approvals, and scheduling controls. |
| Route planning | Already represented | Retained route plans and schedule recommendations support operator planning. They remain advisory and do not promise appointments, dispatch crews, or claim third-party route-optimizer output. |
| Fleet and equipment | Already represented | Tool and equipment directories, reservations, custody, inspections, maintenance, retirement, utilization, dispatch blockers, and 5S controls are canonical ledger features. |
| CRM | Already represented | The opportunity pipeline, client directory, activities, qualification, market fit, bid/no-bid, conversion, client portal, warranty, feedback, and follow-up controls are canonical. |
| Scheduling | Already represented | Portfolio scheduling, task dependencies, critical path, look-ahead, baselines, capacity, workforce availability, Last Planner controls, and approval-gated commitments are canonical. |

## Deliberate exclusions

- Duplicate Node, React, TypeScript, Python, SQLite, and dashboard runtimes.
- Prototype-only state stores and simulated autonomous engines.
- Nested archives, installers, generated output, and vendored dependencies.
- Scraped vendor implementations, copied proprietary code, or compatibility
  layers without an active consumer.
- Live government, messaging, payments, supplier-ordering, route-provider, or
  AI integrations without a verified provider configuration and auditable
  approval gate.

## Acceptance boundary

New archive behavior belongs in Contractor.AI only when it:

1. Adds a capability not already covered by the operating ledger.
2. Preserves exact replay, immutable source evidence, role boundaries, and
   approval-gated external consequences.
3. Works in local SQLite and hosted PostgreSQL modes through the same contract.
4. Has API, migration, backup/restore, export, browser, and security coverage
   appropriate to its risk.
5. Does not overstate a regulatory calculation, certification, registration,
   submission, payment, communication, or external provider action.

The BENG and energy-performance port is the only archive family that met these
criteria as a clear missing product capability in this review.
