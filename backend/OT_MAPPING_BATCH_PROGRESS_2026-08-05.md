# OT Mapping Batch Progress - Tecnicopters

Date: 2026-08-05
Organization: tecnicopters

## Proposals generated

- Batch 1 (high confidence, auto chapter+interval): 5 mappings
- Batch 2 (single candidate heuristic): 18 mappings

Files:
- data/ot-mapping-batch1-high-confidence.csv
- data/ot-mapping-batch2-single-candidate.csv

## Coverage progression

Source OT normalized rows: 503

| Stage | Approved mappings | OT insertable (dry-run) | OT skipped | Compliance rows in DB |
|---|---:|---:|---:|---:|
| Baseline (before new batches) | 3 | 19 | 484 | 19 |
| After Batch 1 applied | 8 | 25 | 478 | 44 |
| After Batch 2 applied | 26 | 47 | 456 | 91 |

## Delta by batch

- Batch 1 delta:
  - Approved mappings: +5
  - OT insertable: +6
  - Compliance rows persisted: +25 (from 19 to 44)

- Batch 2 delta:
  - Approved mappings: +18
  - OT insertable: +22
  - Compliance rows persisted: +47 (from 44 to 91)

- Total delta (Batch 1 + Batch 2):
  - Approved mappings: +23
  - OT insertable: +28
  - Compliance rows persisted: +72 (from 19 to 91)

## Remaining main gap

- OT rows still blocked: 456/503
- Primary reason: mappingNotApproved (no approved mapping for taskCode_origen)
