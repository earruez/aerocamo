# ACCDB Import Audit - Tecnicopters

Date: 2026-08-05
Source file: backend/Publi G (1).accdb
Target organization: tecnicopters (932ccbff-975e-48a1-896b-afebe6d8c8a8)

## 1) Source Inventory (ACCDB)

Tables found: 17

| Table | Rows |
|---|---:|
| AERONAVES | 3 |
| CMA | 6 |
| DOC | 7 |
| EQ | 8 |
| Errores de pegado | 20 |
| ESTADO | 2 |
| HERRAM | 0 |
| ITEM | 1219 |
| OPCION AD | 6 |
| OPCION COMP | 4 |
| OT | 99 |
| TIPO | 7 |
| TN | 11 |
| USUARIOS | 3 |
| MOD | 28 |
| OPCION SI | 2 |
| TAREAS | 1045 |

Total source rows across tables: 2470

## 2) Import Pipeline Executed

- ACCDB extraction to CSV completed.
- Access import diagnostic + write executed with:
  - prisma/import_access_csv.ts --csv-dir ./data --org-id <Tecnicopters>
- OT-only dry-run executed to classify skipped rows.
- OT-only write executed after creating maintenance tasks for approved mappings.

## 3) What Was Imported Into Tecnicopters

Current DB counts after import:

- users: 1
- aircraft: 4
- aircraftEngines: 3
- aircraftEngineUsageLogs: 3
- components: 270
- maintenanceTasks: 2
- compliances (from OT): 19

Notes:
- componentes.csv had 271 candidate rows; 270 persisted due deduplication constraints.
- OT import reached 19 rows only after provisioning maintenance tasks from approved mappings.

## 4) OT Coverage and Exclusions

Source for OT import: ot_normalizado.csv (503 normalized rows generated from OT data)

OT dry-run breakdown (with aircraft/components/tasks loaded from DB):

- inserted candidate rows: 19
- skipped rows: 484
- reason mappingNotApproved: 484
- reason maintenanceTaskNotFound: 0
- reason aircraftNotFound: 0
- reason componentNotFound: 0

Conclusion:
- Main blocker for OT completeness is mapping approval coverage, not technical failure.

## 5) ITEM/EQ Transformation Coverage

From mapping-report-v2.json:

- ITEM rows analyzed: 1219
- EQ rows analyzed: 8
- motors generated: 3
- motors omitted: 5
- components generated: 271
- components omitted/manual review: 30

Primary omission reasons:
- Invalid or placeholder serial numbers (majority)
- Missing PN (minority)
- Engine position missing/unsupported in some EQ rows

## 6) ACCDB Tables Not Yet Ingested by Current Importer

Not covered by prisma/import_access_csv.ts modules today:

- CMA
- DOC
- Errores de pegado
- ESTADO
- HERRAM
- OPCION AD
- OPCION COMP
- OPCION SI
- TIPO
- TN
- USUARIOS (Access users table)
- MOD
- TAREAS

Covered modules today:
- aeronaves (AERONAVES)
- motores (derived from EQ)
- componentes (derived from ITEM)
- ot (derived from OT normalized + approved task mapping)

## 7) Audit Verdict

- The application does not yet cover 100% of ACCDB content.
- It covers core operational entities (aircraft, engines, components) and a mapped subset of OT/compliance.
- Largest functional gap is OT semantic mapping (484/503 normalized OT rows pending mapping approval).
- Second gap is absence of ingestion flows for several source tables listed above.

## 8) Recommended Next Steps to Reach Full Coverage

1. Complete OT mapping approval workflow for all pending taskCode_origen entries.
2. Add importer for TAREAS into maintenance task catalog/domain model (or derive canonical tasks from ITEM/TAREAS).
3. Define ingestion targets for currently uncovered tables (CMA, DOC, MOD, USUARIOS, etc.).
4. Re-run OT import after mapping completion and verify compliance count progression.
