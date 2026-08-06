# Due Engine Integration Tests

This document describes how to run and interpret the Due Engine API-contract integration suite.

## Command

Run from the `backend` folder:

```bash
npm run test:integration:due-engine
```

The script is DB-gated and runs:

```bash
RUN_DB_INTEGRATION_TESTS=1 jest --runInBand src/test/dueEngine.integration.test.ts
```

## Requirements

- PostgreSQL must be reachable through `DATABASE_URL`.
- The current Prisma schema/migrations must be applied in the target database.
- The configured DB user must have create/read/write permissions required by test fixtures.

## What This Suite Validates

- `due-summary` contract (totals, grouped counters, nearest due list).
- `due-rows` unfiltered contract shape.
- Method filters: `H`, `M`, `C`, `N1`, `N2`.
- Source type filters: `AD`, `SB`, `INSPECTION`, `COMPONENT`.
- `due-report-data` payload contract.
- `NO_CONTEXT` behavior for missing explicit operational counters.
- Invalid aircraft handling (error envelope and status behavior).

## Operational Note

If local DB permissions block execution, run the suite against a test database (local or CI) with proper privileges.
