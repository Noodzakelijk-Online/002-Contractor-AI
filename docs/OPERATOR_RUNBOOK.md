# Operator Runbook

## Local startup

Requirements: Node.js 22 and npm.

```powershell
npm install
npm run build
npm start
```

Open `http://localhost:3000`. Local mode defaults to SQLite and private local
evidence storage. Complete Business identity in Operations before issuing packages.

For a portable Windows 11 installation, use the CI-produced
`ContractorAI-windows-x64.zip` and start `ContractorAI.cmd`. Its random owner
key and ledger remain under `%LOCALAPPDATA%\ContractorAI`; see
`docs/WINDOWS_STANDALONE.md`.

Temporary remote access must use `npm run start:tunnel` or
`ContractorAI-Tunnel.cmd`. The launcher requires both ngrok and Contractor.AI
authentication, binds the app to loopback, and prints the public URL only after
local readiness, anonymous rejection, and authenticated public-edge checks pass.
It does not convert local storage into hosted storage. See `docs/NGROK.md`.

To make internal Contractor.AI review actions visible in HAI, configure an absolute
`CONTRACTOR_AI_HAI_FEED_PATH` inside HAI's local feed root. An owner can then inspect
and publish the read-only feed from Operations; the server atomically replaces and
verifies the file. `npm run export:hai` remains available for manual download/export.
Register or sync HAI's `generic_json_feed` separately; see `docs/HAI_CONNECTOR.md`.

For development, run `npm run dev:api` and `npm run dev` in separate terminals.
The Vite client proxies API calls to the Node service.

## Daily checks

1. Confirm the header does not show a safety-stop or readiness warning.
2. Review Today exceptions, approvals, dispatch readiness, expiring compliance,
   overdue actions, evidence gaps, and finance handoffs.
3. Verify provider readiness before any delivery-dependent work.
4. Resolve approvals from retained evidence, not from a notification alone.
5. Close the daily operating cycle and review reasons for variance.

## Diagnostics

```powershell
npm run doctor -- --url http://localhost:3000 --token <owner-role-key>
```

The CLI exits non-zero when readiness is not `ready`. It prints a minimized support
bundle and no environment values. The same JSON can be downloaded by the owner in
Operations. Review it before sharing.

Common states:

| Code/state | Action |
| --- | --- |
| `authentication_required` | Sign in with the correct role key; do not add a fallback secret |
| `forbidden` | Use an authorized role; do not weaken the route |
| `automation_suspended` | Read the retained reason; owner resumes only after the issue is resolved |
| `provider_recovery_required` | Use managed PostgreSQL/S3 recovery, not a container-local backup |
| `audit_integrity_failed` | Stop writes and recover/reconcile; never re-chain silently |
| `source_changed` / conflict | Reload current source and submit a deliberate revision |
| `integration_not_verified` | Configure and acceptance-test the real provider |
| readiness `503` | Inspect authenticated readiness/support bundle and fix every failing control |

## Safety stop

The owner can use Operations or these endpoints:

```text
POST /api/operations/control/suspend
{"confirmation":"SUSPEND_AUTOMATION","reason":"incident reference"}

POST /api/operations/control/resume
{"confirmation":"RESUME_AUTOMATION","reason":"controls verified"}
```

Suspension blocks scheduled and applied autonomous drafting. It does not stop site
equipment, send an emergency notification, or replace physical Stop Work Authority.

## Local backup and restore

Create and verify a backup in Operations, then download the `tar.gz` and the
operator-readable export to encrypted off-device storage. Stop the server before a
restore:

```powershell
tar -xzf contractor-ai-backup-<backup-id>.tar.gz -C ./data/backups
npm run restore:local -- --backup-id <backup-id> --confirm RESTORE_<backup-id>
```

The command requires the same `CONTRACTOR_AI_BACKUP_SIGNING_KEY` used to create the
backup. It acquires an exclusive runtime lease, authenticates the manifest, checks
checksums, SQLite integrity, canonical tables, and private evidence, then stages the
whole recovery set. It creates a pre-restore recovery package, rolls back database
and evidence together on failure, and revokes restored browser sessions. Restart the
process after success. Historical unsigned v1/v2 packages require the explicit
`--allow-legacy-unsigned` compatibility flag.

## Release verification

```powershell
npm run lint
npm audit
npm run verify:release
npm run test:frontend
npm test
npm run build
npm run benchmark:ledger
npm run test:browser
npm run test:container
```

Do not release when one gate fails. PostgreSQL tests require the CI service or an
explicit disposable test URL. Browser and container gates require their local
runtimes. The production-scale benchmark uses only a disposable synthetic SQLite
ledger and removes it after the run. Use `--output <path>` to retain the JSON
report; use `npm run test:performance` for the smaller developer smoke profile.

## EU hosted deployment

1. Select an EU provider and region; retain the signed DPA and retention policy.
2. Provision TLS-managed PostgreSQL with backups/PITR and private EU S3-compatible
   storage with versioning and prefix-scoped credentials.
3. Configure every value in `.env.hosted.example`, including exact HTTPS/CORS/proxy
   values. Do not commit the resulting file.
4. Create, validate, download, and separately retain a local v2 backup and export.
5. With the app stopped, migrate into an empty target using `npm run migrate:hosted`.
6. Verify the migration receipt, row/evidence reconciliation, audit integrity,
   authenticated readiness, provider storage probe, and owner login.
7. Run container/browser acceptance behind the real HTTPS ingress.
8. Perform a canary, reconcile external actions, and test rollback/recovery before
   admitting production users.

Hosted recovery uses provider PostgreSQL and object-version recovery. Container
files are not a backup. See `docs/EU_HOSTING.md` for the full contract.

## Maintenance

- Apply dependency updates in a branch and run every release gate.
- Add schema only through a new append-only migration; never edit an applied one.
- Update `CHANGELOG.md` and the goal matrix for behavior or readiness changes.
- Run a restore exercise after provider, schema, storage, or backup-policy changes.
- Review users, provider scopes, expiring credentials, data retention, and archived
  records on the organization's documented schedule.
