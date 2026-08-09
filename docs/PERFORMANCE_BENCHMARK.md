# Ledger Performance Benchmark

The benchmark is a deterministic, disposable release gate for the local-first
SQLite ledger. It does not read, copy, or retain customer data.

## Profiles

| Profile | Retained fixture | Purpose |
| --- | --- | --- |
| `smoke` | 620 jobs, 1,240 tasks, 620 opportunities, 500 approvals, 2,000 audit events | Fast development and Node contract coverage beyond the former 500-row window |
| `production` | 5,000 jobs, 20,000 tasks, 2,500 opportunities, 5,000 approvals, 25,000 audit events; 63,500 core rows total | Release and CI evidence for a mature small/medium contractor ledger |

Both profiles use canonical schema, foreign keys, deterministic identities and
timestamps, and a valid SHA-256 audit chain. The benchmark then performs a real
canonical intake write against the scaled ledger.

## Commands

```powershell
npm run test:performance
npm run benchmark:ledger
npm run benchmark:ledger -- --output artifacts/ledger-benchmark.json
```

The command exits non-zero on a correctness, index, resource, or timing failure.
Temporary databases are removed by default. `--keep` is for local diagnosis only;
never treat the synthetic fixture as an operational backup.

## Contracts

The gate verifies:

- historical job, client, and opportunity search beyond the newest 500 records;
- bounded active-job, opportunity, approval, client, and audit-history responses;
- untruncated opportunity totals and weighted pipeline aggregation;
- required hot-path indexes and complete audit-chain integrity;
- initial startup, scaled reopen, fixture generation, dashboard, canonical intake,
  audit verification, database footprint, and resident-memory growth thresholds.

The production thresholds allow slower shared CI hosts while still catching
unbounded regressions: ordinary reads p95 under 1 second, dashboard p95 under 4
seconds, canonical write p95 under 3 seconds, audit verification under 5 seconds,
database under 128 MiB, and measured resident growth under 512 MiB.

## Retained Baseline

On 2026-08-09, the packaged Windows Node 22.23.2 runtime passed the production
profile with a 1.51-second fixture seed, 7.05 ms reopen, 620.83 ms dashboard p95,
86.24 ms canonical-intake p95, 352.02 ms audit verification, and about 37 MiB of
SQLite storage. Bounded list/search p95 values were 2.03-23.40 ms except the
approval and audit queues, which remained under 13 ms.

CI runs the production profile and uploads `ledger-performance-report`. Compare
the JSON environment, fixture, p50, p95, response bytes, memory, and disk evidence
before accepting a regression or changing a threshold.

## Hosted Boundary

This gate proves the local SQLite operating mode. PostgreSQL runs the same ledger
contract, migrations, TLS, backup migration, and integration suite in CI, but a
chosen EU provider still requires load and recovery acceptance in its actual
region, plan, ingress, database, and object-storage configuration. Do not use this
local result as evidence for an untested hosted service level.
