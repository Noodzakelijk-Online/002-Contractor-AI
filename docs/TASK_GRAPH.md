# Task Graph

```mermaid
flowchart TD
  A["000-004: establish repository, product, critical path, architecture"] --> B["005-010: data, config, auth, API, frontend boundaries"]
  B --> C["011: core workflow vertical slice"]
  C --> D["012-030: providers, compliance, persistence, workers, privacy, security"]
  D --> E["031-039: local, Docker, migrations, doctor, diagnostics, test fixtures"]
  E --> F["040-048: backend, browser, worker, adversarial and provider tests"]
  F --> G["049-058: accessibility, responsive, performance, recovery, rollout"]
  G --> H["059-067: state/domain/invariants, safety, threat/privacy/supply chain"]
  H --> I["068-077: CI, release, runbooks, UI/API/docs/debt/bug evidence"]
  I --> J["078-096: red-team loops, operator simulations, traceability, final gates"]
  J --> K["097-115: final report, maintenance, support, retention, safety, onboarding"]
  K --> L["Local release candidate"]
  L --> M{"External provider and EU infrastructure evidence complete?"}
  M -- No --> N["Keep external actions disabled; report blockers"]
  M -- Yes --> O["Canary, recovery drill, human operator acceptance"]
  O --> P["EU-hosted production approval"]
```

## Delivery dependencies

1. The ledger contract precedes the UI and external provider adapters.
2. Authentication, role checks, source-currentness, idempotency, and audit integrity
   precede every side-effecting workflow.
3. A package/approval precedes delivery; provider receipt precedes delivered state;
   client evidence precedes accepted state.
4. Local backup verification precedes hosted migration. Empty managed PostgreSQL,
   private object storage, DPA/residency/retention declarations, and storage probes
   precede hosted startup.
5. Lint, audit, release contract, unit/integration, build, browser, and container
   verification precede release. Provider acceptance and recovery drills precede
   real production enablement.

## Stabilization gates

| Gate | Exit condition |
| --- | --- |
| G0 Repository | clean understood starting point; no duplicate runtime |
| G1 Runtime | one Node process and built React client work locally |
| G2 Data | migrations, transactions, audit, replay and backups verify |
| G3 Product | contractor critical path works without fake side effects |
| G4 Security | auth, role, CORS, rate, file, portal, safety controls verify |
| G5 Delivery | CI/build/browser/container gates pass |
| G6 Hosted | operator supplies EU provider evidence and completes migration/recovery/canary |
