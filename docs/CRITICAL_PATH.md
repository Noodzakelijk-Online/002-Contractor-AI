# Critical Path

The minimum useful operator outcome is:

`lead -> qualification -> survey -> estimate -> approved quote package -> client acceptance evidence -> job -> plan -> execute -> verify -> variation control -> handover -> invoice package -> verified delivery -> payment evidence -> warranty/feedback`

## Required transitions

| Stage | Retained evidence and gate | Primary contract |
| --- | --- | --- |
| Intake | Named opportunity, contact consent, source, scope | `/api/ledger/opportunities` |
| Qualify | Current ICP/service-area assessment and bid decision | `/market-fit-assessments`, `/bid-decisions` |
| Survey | Checklist, private evidence, source-current approval | `/site-surveys` |
| Estimate | WBS takeoff, rate basis, scope/assumptions/exclusions | `/takeoffs`, `/estimate-rates`, `/commercial-scope` |
| Quote | Internal approval, immutable package, separate communication approval | `/estimates/:id/approve`, `/quote-issue-package` |
| Accept | Dated evidence bound to issued package and verified delivery | quote acceptance evidence routes |
| Plan | Baseline schedule, constraints, crew capacity, permits, risk | job planning and assurance routes |
| Execute | Attendance, daily logs, Last Planner, daywork, controlled documents | job field routes |
| Verify | LMRA, inspection/QC, NCR, before/during/after evidence | assurance and evidence routes |
| Change | Source-bound variation, package, verified issue, acceptance | `/change-orders` |
| Handover | Snags, systems completion and checksum-protected dossier | handover routes |
| Bill | Milestone, approved invoice, immutable HTML/UBL package | invoice routes |
| Deliver/pay | Allowlisted provider receipt and external payment evidence | communication and payment routes |
| Learn | Actuals, feedback, closeout, archive, scorecard | learning and performance routes |

## Safety invariants

- Drafting is not delivery, approval is not client acceptance, and package creation
  is not an external commitment.
- Financial totals are derived from retained validated lines on the server.
- A retry key cannot be reused with a different payload.
- Evidence is private and must be checksum-verifiable before a governed action.
- Role, lifecycle, compliance, approval, and source-currentness gates are enforced
  in the ledger transaction, not inferred from the UI.
- The owner safety stop blocks scheduled cycles and command-plan application while
  preserving dry-run diagnosis and direct human-authored ledger work.

## Smoke test

1. Start from a fresh local SQLite data directory.
2. Sign in as owner and complete business identity.
3. Create and qualify an opportunity.
4. Record a site survey and approve its retained evidence.
5. convert the opportunity, create WBS/takeoff/rate/scope evidence, then prepare a
   quote package through approval.
6. Record separately verified client acceptance and plan the job.
7. Complete a field task with LMRA, daily evidence, and installation QC.
8. Create a variation and confirm that internal approval alone does not change
   contract value.
9. Prepare invoice/handover artifacts and confirm external status changes only
   after a verified receipt.
10. Create and validate a backup, export the ledger, suspend automation, run the
    doctor, resume automation, and verify the audit chain.

The automated portions are covered by Node integration tests and browser tests.
Real provider delivery and production recovery remain explicit operator acceptance
steps because credentials and infrastructure are not part of the repository.
