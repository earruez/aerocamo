# Component Tracking Backfill (Phase 5.1)

This backfill migrates historical legacy data into canonical tracking tables:

- `component_instances`
- `component_applications`
- `component_movements`

## Prerequisites

1. Apply schema migration for canonical tracking model:

```bash
cd backend
npm run prisma:apply:component-tracking-backend-model
```

2. Regenerate Prisma client:

```bash
npm run prisma:generate
```

## Run

```bash
cd backend
npm run backfill:component-tracking
```

The script prints a JSON report with created/reused/skipped/ambiguous/error counters.

## Verification (Phase 5.2)

Run validation and reporting (no schema/business logic changes):

```bash
cd backend
npm run verify:component-tracking-backfill
```

This verification script includes:

- global legacy vs canonical counts and coverage
- random sampling validation (10 cases when available)
- timeline reconstruction comparison
- edge case checks
- traceability checks
- idempotency check (runs backfill twice and compares deltas)

## Idempotency behavior

Backfill is safe to rerun.

- ComponentInstance: reused by deterministic lookup on `organizationId + legacyComponentId`.
- ComponentApplication: reused by marker in notes: `[legacy:compliance:<id>]`.
- ComponentMovement:
  - single events reused by marker `[legacy:component_history:<id>]`
  - replacement events reused by marker `[legacy:component_history_pair:<removeId>:<installId>]`

No in-memory-only uniqueness is used.

## Mapping summary

### Component -> ComponentInstance

- Source: legacy `components`
- Definition resolution:
  - exact one task from `component_tasks` or from historical `compliances` task linkage
  - if 0 or >1 candidate tasks: row skipped as ambiguous
- Traceability:
  - `legacyComponentId` stores original component id

### Compliance -> ComponentApplication

- Source: legacy `compliances` where `componentId` is not null
- Requires resolvable canonical `ComponentInstance`
- Work request link preserved only when uniquely resolvable
- Traceability markers appended to notes:
  - `[legacy:compliance:<id>]`
  - `[legacy:performedBy:<userId>]`

### ComponentHistory -> ComponentMovement

- Source: legacy `component_history`
- Deterministic replacement pairing:
  - same org + aircraft + workOrder + position + movedAt
  - exactly one `REMOVED` + one `INSTALLED` => one explicit `replacement` movement
- Non-paired rows become `install` or `remove`
- Traceability markers in notes:
  - `[legacy:component_history:<id>]`
  - replacement pair marker when applicable

## What is skipped/reported

Rows are skipped and reported (not silently invented) when:

- definition mapping is ambiguous/unresolved
- component instance link cannot be resolved
- work-request mapping is ambiguous (applications)
- replacement grouping is ambiguous
- validation or unexpected errors occur

## Notes

- This backfill does not redesign schema and does not add unrelated features.
- It prioritizes explicit reporting over silent assumptions.
