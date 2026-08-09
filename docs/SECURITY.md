# Security and Privacy

## Trust boundaries

Contractor.AI treats browser input, uploaded files, portal tokens, proxy headers,
provider receipts, and imported backups as untrusted. The Express layer authenticates
and validates requests; the ledger rechecks authorization-sensitive invariants in
the same transaction as the business change. PostgreSQL and private object storage
are the hosted durability boundary.

## Roles

| Role | Intended authority |
| --- | --- |
| `owner` / `approver` | Organization settings, approvals, recovery, diagnostics, audit, safety stop |
| `office_operator` | Commercial, planning, project-control, and governed office records |
| `field_worker` | Assigned field records and evidence only |
| client portal token | Narrow job/action scope, expiry, and approval-backed response only |

Production role keys must be independent non-template secrets of at least 32
characters. Browser login exchanges a key for a signed, revocable, HTTP-only,
Secure, SameSite=Strict cookie. Keys and cookies are not stored in local storage.
Rotate the role key to invalidate its sessions after suspected disclosure.

## Application controls

- Explicit CORS allowlist and same-origin checks for cookie-authenticated writes.
- Strict hosted proxy allowlist; boolean, wildcard, universal CIDR, and numeric-hop
  trust settings fail startup.
- Persisted, bounded, HMAC-bucketed API and login rate limits that do not retain the
  source address.
- Helmet-equivalent explicit security headers and CSP compatible with the Vite
  production bundle; no inline event handlers or runtime HTML-string UI rendering.
- JSON and upload size limits; extension, MIME, signature, path, checksum, ownership,
  and status checks for evidence.
- Stored evidence is read through authenticated ledger routes, never public static
  paths or object URLs.
- SHA-256 chained audit events are committed with the underlying mutation.
- Exact idempotency and lease ownership prevent changed retries and stale workers.
- External commitments require a separate approval and an allowlisted verified
  provider receipt. Internal approval or package creation is not delivery.

## Local exposure and HAI

The Windows standalone launcher binds only to `127.0.0.1`, retains its random
owner key under the current user's `%LOCALAPPDATA%`, and does not place the key
in browser storage or a URL. The ngrok launcher fails before public exposure
unless both ngrok agent authentication and strong Contractor.AI owner
authentication are present. It trusts only the local proxy hop and configures
the exact returned HTTPS origin.

The HAI connector is export-only. Its owner endpoint and local exporter expose
bounded internal action summaries without evidence bodies, arbitrary ledger
payloads, credentials, or write-back authority. Each item explicitly declares
that it cannot execute and creates zero external commitments. Exported records
use HAI's maintained `accountfeed.GenericItem` input fields; the compatibility
verifier can execute HAI's parser from a temporary copy without modifying the
HAI checkout or granting either system command authority.

## Operational safety stop

The owner can suspend `autonomous_work` using an explicit confirmation phrase.
The state is persisted, revisioned, and audited. It blocks command-plan application,
scheduled cycle claims, and non-dry autonomous cycles with HTTP 423. It does not
block direct human-authored ledger work, backups, audit inspection, or a dry run.
It cannot call emergency services or stop physical machinery; site emergency and
Stop Work Authority procedures remain the responsibility of trained personnel.

## Support data boundary

`/api/operations/support-bundle` is owner-only. It includes application version,
release id, runtime/readiness status, migration names, aggregate table counts,
audit integrity, and automation state. It explicitly excludes customer and job
records, evidence content, logs, environment values, tokens, cookies, credentials,
connection strings, and storage keys. Operators should still review the JSON before
sharing it outside the organization.

## Hosted controls

Hosted startup fails unless all of the following are declared and testable:

- public HTTPS URL, exact CORS origin, and restricted ingress proxy trust;
- production authentication and bounded session/login/API policies;
- EU provider, region, `CONTRACTOR_AI_DATA_RESIDENCY=EU`, retained DPA reference,
  and retained retention-policy reference;
- TLS PostgreSQL with managed snapshot/PITR recovery declaration;
- private HTTPS S3-compatible EU storage, scoped prefix, successful write/read/delete
  probe, versioning declaration, and retained backup-policy reference.

Declarations are not attestations. The operator must retain contracts, region
evidence, restore-test evidence, subprocessors, and incident contacts separately.

## Privacy impact summary

Likely personal data includes client contact details, worker assignment and
attendance, portal actions, evidence metadata, audit actor identifiers, and uploaded
site files. Collect only what a job requires. Field time records are not location
tracking; payment evidence is not bank initiation; worker records are not payroll.

Use organization policy and legal review to define purpose, lawful basis, access,
retention, data-subject handling, export, and erasure exceptions. Contractor.AI uses
non-destructive archive because invoices, contracts, safety, warranty, and audit
evidence can have conflicting statutory retention duties. It does not automatically
erase immutable evidence or claim AVG/GDPR compliance.

## Incident response

1. Activate the autonomous-work safety stop.
2. Restrict ingress and revoke/rotate role keys and provider credentials.
3. Preserve audit and provider evidence; do not rewrite the chain.
4. Run `npm run doctor` and verify `/api/operations/audit-integrity`.
5. Recover only from a checksum-verified backup or provider recovery point.
6. Reconcile external provider actions before retries.
7. Follow the organization's legal notification and data-breach process.

Do not commit `.env` files, data directories, downloaded backups, support bundles,
provider receipts, or uploaded evidence.
