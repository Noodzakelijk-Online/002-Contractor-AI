# Contractor.AI

Contractor.AI is a local-first operating system prototype for contractor, maintenance, garden, renovation, handyman, and small construction teams. The current app is centered on a persisted operating ledger that tracks jobs from intake through planning, field execution, approvals, finance, and aftercare.

The product goal is practical coordination: reduce Robert's manual follow-up, keep client and worker commitments visible, and make consequential actions approval-gated before anything external is sent or committed.

## What Works Now

- Node/Express dashboard and API in `server.js`.
- Static operational dashboard in `public/index.html`.
- SQLite-backed operating ledger in `operating-ledger.js`.
- Durable local records for clients, jobs, tasks, quotes, workers, tools, materials, assignments, documents, progress, communication, time logs, expenses, invoices, approvals, audit events, route plans, weather assessments, safety/quality records, aftercare, recurring plans, and finance handoff packages.
- Local upload handling for job evidence and documents under `UPLOAD_DIR`.
- Operator-triggered live weather assessments through Open-Meteo, persisted with forecast provenance and converted into approval-gated schedule recommendations when risk is detected.
- Approval gates for quotes, invoices, external communication, high-risk schedule/status changes, finance actions, worker/tool conflicts, safety/quality signoff, and other consequential records.
- Approval-gated client portal links with hashed local tokens, a restricted client-facing job view, inbound client requests, expiry, revocation, and audit history.
- Production/remote dashboard access guard with bearer token, `X-Contractor-AI-Token`, `X-API-Key`, or browser Basic Auth support.
- Destructive dashboard actions retain records and route archive/delete intent through approval records instead of silently removing operational history.
- Autonomous cycle endpoints that create internal drafts, tasks, checks, reminders, invoice drafts, and approval-gated communications without sending external messages.
- Node test coverage for the operating ledger, dispatch, field assurance, finance, inventory, workforce, client follow-up, learning profiles, schedule approvals, and autonomous open loops.

The Python backends under `advanced_ai_backend/`, `contractor_ai_backend/`, and `god_mode_contractor_ai/` remain prototype layers. Treat their mock fallbacks as development scaffolding, not production AI services.

## Local Setup

Requirements:

- Node.js 22.x
- npm
- Windows 11 PowerShell, or another shell with equivalent commands

Install dependencies:

```powershell
npm install
```

Create local configuration:

```powershell
Copy-Item .env.example .env
```

Start the local app:

```powershell
npm start
```

Open:

```text
http://localhost:3000
```

The default local runtime paths are:

- `./data/server-state.json`
- `./data/contractor-ledger.sqlite`
- `./data/uploads`

These paths are ignored by git. Do not commit local databases, uploaded client files, photos, invoices, or runtime state.

## Configuration

Use `.env` for local settings. The supported root settings are documented in `.env.example`:

- `PORT`
- `NODE_ENV`
- `STATE_FILE`
- `LEDGER_DB_FILE`
- `UPLOAD_DIR`
- `MAX_UPLOAD_BYTES`
- `CORS_ORIGINS`
- `CONTRACTOR_AI_REQUIRE_AUTH`
- `CONTRACTOR_AI_AUTH_TOKEN`
- `WEATHER_PROVIDER_ENABLED`
- `WEATHER_PROVIDER_TIMEOUT_MS`

Do not put secrets in committed files. The current app is designed for local-first use. In production, dashboard/API authentication is required unless `CONTRACTOR_AI_REQUIRE_AUTH=false` is explicitly set for a trusted private host. Use transport security before exposing the app over a tunnel or public network.

## Main API Areas

Core:

- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/ledger/debug`
- `GET /api/audit`

Ledger:

- `POST /api/ledger/intake`
- `GET /api/ledger/jobs`
- `GET /api/ledger/jobs/:id`
- `PUT /api/ledger/jobs/:id`
- `POST /api/ledger/jobs/:id/tasks`
- `POST /api/ledger/jobs/:id/quote`
- `POST /api/ledger/jobs/:id/assignments`
- `POST /api/ledger/jobs/:id/tools`
- `POST /api/ledger/jobs/:id/materials`
- `POST /api/ledger/jobs/:id/documents`
- `POST /api/ledger/jobs/:id/progress`
- `POST /api/ledger/jobs/:id/communication`
- `POST /api/ledger/jobs/:id/time-logs`
- `POST /api/ledger/jobs/:id/expenses`
- `POST /api/ledger/jobs/:id/invoices`
- `POST /api/ledger/jobs/:id/closeout`
- `GET /api/ledger/jobs/:id/client-portal-access`
- `POST /api/ledger/jobs/:id/client-portal-access`
- `POST /api/ledger/client-portal-access/:id/revoke`

Client portal:

- `GET /client-portal.html#token=<portal-token>`
- `GET /api/client-portal/:token`
- `POST /api/client-portal/:token/messages`

Operations:

- `GET /api/ledger/dispatch`
- `GET /api/ledger/field-assurance`
- `GET /api/ledger/finance`
- `GET /api/ledger/inventory`
- `GET /api/ledger/workforce`
- `GET /api/ledger/client-success`
- `POST /api/weather/assess`
- `POST /api/schedule/recommend`
- `POST /api/schedule/prepare-dispatch`
- `POST /api/ledger/autonomous-cycle`

Approvals:

- `GET /api/approvals`
- `POST /api/approvals/:id/resolve`
- `POST /api/ledger/approvals/:id/resolve`

Legacy-compatible endpoints such as `/api/jobs`, `/api/workers`, and `/api/tools` still exist for the older dashboard flows, but the operating-ledger endpoints are the authoritative local workflow.

## Safety Model

Contractor.AI may create internal drafts and records automatically, including tasks, tool lists, route plans, weather checks, worker instructions, aftercare drafts, recurring-service preparations, and invoice drafts.

Live weather is fetched only when the operator selects a live assessment for a job. Each result records its forecast time, provider, location coordinates, and weather values in the job ledger. If the provider is disabled or unavailable, Contractor.AI records nothing and returns an explicit error; operators can still submit a manual field assessment with its own recommendation.

The app must not silently:

- send external client or worker messages;
- send quotes or invoices;
- commit Robert to dates, scope, supplier spend, or payment actions;
- delete records or uploaded files without an approval-backed archive flow;
- mark high-risk work complete;
- bypass approval records for consequential actions.

Approval records and audit events are the source of truth for consequential actions.

Client portal links are disabled until their corresponding approval is resolved. The database stores only a SHA-256 hash of the access token; the raw link is shown to the operator once when it is created. The portal exposes only client-safe job context and records messages as inbound requests. It cannot approve scope, price, dates, safety, or payment decisions.

## Tests

Run the Node test suite:

```powershell
npm test
```

Run a production build:

```powershell
npm run build
```

If a sandboxed environment blocks Vite from reading `vite.config.js`, rerun the same build in a normal local shell.

## Project Structure

```text
server.js                  Express API, dashboard serving, legacy compatibility
operating-ledger.js         SQLite operating ledger and autonomous workflow logic
autonomous-engine.js        In-memory planning engine used by legacy/demo flows
public/index.html           Main dashboard UI
tests/                      Node test suite for ledger and operations
advanced_ai_backend/        Prototype Python AI backend
contractor_ai_backend/      Prototype Python contractor backend
god_mode_contractor_ai/     Prototype Python automation backend
```

## Current Gaps

- External communication providers are not wired for real sending.
- Python AI services still contain mock fallback behavior.
- Database migrations are embedded in the ledger initialization rather than managed as separate migration files.
- Postgres, HAI, and FAB integrations are intentionally not implemented yet.

The next useful work is to keep replacing legacy mock surfaces with persisted ledger data, add transport/security hardening for any remote deployment, and continue tightening autonomous workflows around approval-gated drafts.
