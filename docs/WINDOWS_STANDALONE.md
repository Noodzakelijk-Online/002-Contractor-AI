# Windows 11 Standalone Operation

## Release artifact

The `windows-standalone` GitHub Actions job builds
`ContractorAI-windows-x64.zip` on Windows x64 with Node.js 22. The package
contains its own `runtime\node.exe`, the production Vite output, the canonical
Node ledger runtime, and production dependencies. It does not require a global
Node.js or npm installation.

Extract the archive to an operator-controlled folder and start
`ContractorAI.cmd`. Do not run it directly from inside the zip archive.

## First run

The launcher creates these local-user resources:

```text
%LOCALAPPDATA%\ContractorAI\config\runtime.json
%LOCALAPPDATA%\ContractorAI\data\contractor-ledger.sqlite
%LOCALAPPDATA%\ContractorAI\data\uploads\
```

`runtime.json` contains a random 256-bit owner access key. The launcher applies
current-user file permissions where Windows permits it, prints the key once on
first run, binds the server to `127.0.0.1`, and opens
`http://127.0.0.1:3000`. The key is never written into the application folder,
browser storage, a URL, or the repository.

Later starts report only the protected configuration path and do not repeat the
key in terminal output or redirected logs.

Keep `%LOCALAPPDATA%\ContractorAI` on an encrypted Windows volume. Use the
in-product verified backup workflow and retain copies away from the computer.

## Launchers

- `ContractorAI.cmd`: local-only application.
- `ContractorAI-Tunnel.cmd`: authenticated ngrok access to the same local data.
- `ContractorAI-Export-HAI.cmd`: exports the read-only HAI feed while the local
  application is running. Set `CONTRACTOR_AI_HAI_FEED_PATH` to an absolute file
  under HAI's configured feed root first.
- With that path set before launch, Operations also shows the verified local-feed
  state and provides an owner-only **Publish to HAI** action. The Windows smoke
  gate publishes and reads back this feed with zero execution authority.

## Build locally

The package command intentionally fails outside Windows x64 or Node.js 22:

```powershell
npm ci
npm run package:windows
npm run test:windows-package
```

The unpacked result is under `release\ContractorAI-windows-x64`. Git ignores
the release directory. The package smoke test starts that exact bundled runtime
against an isolated profile and verifies current migration, authentication,
redacted team access, and read-only HAI behavior before cleanup. Signed
distribution and malware scanning remain release owner responsibilities.
