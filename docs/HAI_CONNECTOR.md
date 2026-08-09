# HAI Read-Only Connector

## Boundary

Contractor.AI exports prioritized internal ledger actions in the generic HAI
JSON feed format. Every item has a stable `externalId`, title, bounded body,
`review_contractor_ai_action` operation type, optional source timestamp, and
privacy-minimized metadata. Every item declares `canExecute: false` and
`externalCommitments: 0`.

Active or paused framework implementations whose review date is due appear as
`review_framework_implementation` items. Their stable identity includes the
implementation, due date, and revision. HAI can surface the review but cannot
revise the framework record or execute any resulting decision.

The API is owner-only:

- `GET /api/integrations/hai/manifest`
- `GET /api/integrations/hai/feed?limit=100`

The API does not expose evidence bodies, client contact details, financial line
items, credentials, or arbitrary ledger payloads.

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
  "operationType": "review_contractor_ai_action",
  "enabled": true
}
```

Sync the feed from HAI after each export. HAI preserves raw source JSON and
deduplicates by external id plus content revision. This connector deliberately
does not provide a write-back or command endpoint; consequential actions remain
inside Contractor.AI's authenticated approval workflow.
