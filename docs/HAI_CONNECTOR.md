# HAI Read-Only Connector

## Boundary

Contractor.AI exports prioritized internal ledger actions as HAI
`accountfeed.GenericItem` records. Every item has a stable `externalId`,
`provider: generic_json_feed`, `itemType: document`, a title, bounded `content`,
a non-secret `contractor-ai://` source URI, an optional source timestamp, and
privacy-minimized metadata. Every item declares `canExecute: false` and
`externalCommitments: 0` in its metadata.

HAI derives `operationType: review_document` from `itemType: document` while it
normalizes the source item. Contractor.AI's more specific review category remains
in `metadata.actionType`; it is not emitted as a custom HAI operation type.

Active or paused framework implementations whose review date is due appear as
`review_framework_implementation` items. Their stable identity includes the
implementation, due date, and revision. HAI can surface the review but cannot
revise the framework record or execute any resulting decision.

The API is owner-only:

- `GET /api/integrations/hai/manifest`
- `GET /api/integrations/hai/feed?limit=100`
- `GET /api/integrations/hai/status`
- `POST /api/integrations/hai/publish`

The API does not expose evidence bodies, client contact details, financial line
items, credentials, or arbitrary ledger payloads.

When `CONTRACTOR_AI_HAI_FEED_PATH` is an absolute path, the owner can publish
from Operations without using a terminal. Contractor.AI writes a same-directory
temporary file, replaces the configured feed atomically, reads it back, validates
every GenericItem, and reports the item count, SHA-256, and publication time.
Relative paths fail production readiness. Missing, invalid, oversized, or
unavailable files remain explicit states and never become a successful sync.

## Local feed export

HAI's maintained account-feed runtime already supports `generic_json_feed` with
`local_json_file`. Point the exporter at a file under HAI's configured local
feed root, normally its `connected-sources` directory:

```powershell
$env:CONTRACTOR_AI_HAI_FEED_PATH = 'C:\absolute\path\to\HAI\connected-sources\contractor-ai.json'
npm run export:hai -- --url http://127.0.0.1:3000 --token <owner-access-key>
```

The output path must be absolute. Plain HTTP is accepted only for loopback;
non-loopback exports require HTTPS. The bearer key is sent in the authorization
header and is never placed in the URL or output. The exporter validates the
root array and read-only boundary, writes a temporary file in the destination
directory, renames it into place, and reports only item count, path, and SHA-256.

## Register in HAI

In HAI's Connected Sources screen, register an owner-scoped account feed with:

```json
{
  "name": "Contractor.AI actions",
  "provider": "generic_json_feed",
  "accountLabel": "contractor-ai",
  "sourceType": "local_json_file",
  "path": "contractor-ai.json",
  "workspaceId": "local",
  "ownerUserId": "<HAI owner id>",
  "projectKey": "contractor-ai",
  "operationType": "review_document",
  "enabled": true
}
```

Sync the feed from HAI after each CLI or Operations publication. HAI preserves raw source JSON and
deduplicates by external id plus content revision. This connector deliberately
does not provide a write-back or command endpoint; consequential actions remain
inside Contractor.AI's authenticated approval workflow.

## Compatibility verification

The standard release gate validates the native Contractor.AI shape:

```powershell
npm run verify:hai-contract
```

When the maintained HAI source is available locally, run its actual generic-feed
parser against a generated Contractor.AI fixture. The verifier copies only the
required parser files into a temporary directory and does not change the HAI
checkout. It uses local Go when available and otherwise an isolated Docker Go
runtime with networking disabled:

```powershell
npm run verify:hai-contract -- --hai-root 'C:\absolute\path\to\018-HAI'
```

Parser acceptance proves source compatibility. It does not prove a configured
HAI account-feed sync, owner mapping, or live deployment acceptance.
