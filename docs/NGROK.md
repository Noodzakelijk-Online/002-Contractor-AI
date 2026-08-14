# Authenticated ngrok Operation

ngrok provides temporary HTTPS access to the local Contractor.AI process. The
ledger and evidence remain on the Windows computer. This is not a durable,
multi-user, EU-hosted deployment and does not replace the hosted PostgreSQL,
private object storage, DPA, backup, or residency controls.

## Start from the repository

Set a strong owner access key and the ngrok agent token in the process
environment, then start the governed tunnel launcher:

```powershell
$env:CONTRACTOR_AI_AUTH_TOKEN = '<random-owner-key-at-least-32-characters>'
$env:NGROK_AUTHTOKEN = '<ngrok-agent-token>'
npm run start:tunnel
```

Optional settings:

- `NGROK_DOMAIN`: a domain already reserved on the ngrok account.
- `NGROK_ALLOW_CIDRS`: comma-separated client CIDR ranges enforced at the
  ngrok edge.
- `PORT`: local port, default `3000`.

The launcher opens ngrok first, validates that it returned a clean HTTPS origin,
then configures exact CORS, loopback proxy trust, required Contractor.AI
authentication, and a `127.0.0.1` server bind. It does not announce success merely
because ngrok returned a URL. It verifies, in order:

1. The loopback health endpoint reports ready configuration, database, and storage.
2. The public `/api/readiness` endpoint rejects an anonymous request with `401`.
3. An owner-authenticated public request reaches the expected loopback-only runtime,
   exact HTTPS origin, and pending tunnel state.
4. A final public request confirms the verified tunnel state and timestamp.

If any check fails, the launcher closes public ingress first and then drains the
local runtime. It prints the public URL only after all checks pass. When
`NGROK_ALLOW_CIDRS` is configured, the launching computer must be included in the
allowed public path so it can complete these edge checks.

The Windows package uses the locally retained owner key automatically. Set only
`NGROK_AUTHTOKEN` and start `ContractorAI-Tunnel.cmd`.

## Stop and audit

Close the terminal or press Ctrl+C. The launcher closes ngrok ingress before it
drains the HTTP server and ledger, preventing new public work during shutdown.
Inspect `/api/health/ready` through the tunnel and sign in with the Contractor.AI
owner key. Never put either token in a URL, screenshot, issue, log, or checked-in
environment file.
