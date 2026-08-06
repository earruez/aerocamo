# Access -> Griselle Due Model Mapping

## Scope
Operational equivalence mapping for Access remanentes/due layer into backend-driven Due Engine.

| Access Field | Target Model / Field | Required | Notes | Ambiguity / Manual Review |
|---|---|---:|---|---|
| MATRICULA | Aircraft.registration | Yes | Aircraft identity key for operational control | None |
| MODELO | Aircraft.model | Yes | Display/report dimension | None |
| SERIE | Aircraft.serialNumber | Yes | Aircraft manufacturer serial | None |
| HS TOT | Aircraft.totalFlightHours (authoritative), AircraftUsageLog.totalHours (history) | Yes | Current operational truth from master counters | None |
| CICLOS | Aircraft.totalCycles (authoritative), AircraftUsageLog.totalCycles (history) | Yes | Main cycle counter | None |
| CICLOS N1 | DueRow.method=N1 / dedicated engine-counter source | Conditional | Only valid with explicit source | Missing in current source -> NO_CONTEXT |
| CICLOS N2 | DueRow.method=N2 / dedicated engine-counter source | Conditional | Only valid with explicit source | Missing in current source -> NO_CONTEXT |
| MOTORES A.p.MAT | Aircraft.registration (join key) | Yes | Engine row is linked to aircraft by matrícula | None |
| MOTORES A.p.Orden / Posicion | AircraftEngine.position (N1/N2) | Yes | Explicit value when present; fallback by row order per matrícula (1->N1, 2->N2) | Rows beyond 2 per aircraft are skipped with warning |
| MOTORES A.p.Fabricante | AircraftEngine.manufacturer | Yes | Engine identity metadata | None |
| MOTORES A.p.Modelo | AircraftEngine.model | Yes | Engine identity metadata | None |
| MOTORES A.p.Serie | AircraftEngine.serialNumber | Yes | Required for idempotent match (aircraftId + position + serial) | Missing serial -> row skipped with warning |
| MOTORES A.p.HRS | AircraftEngineUsageLog.hours | Conditional | Initial counter snapshot at import date | Missing HRS/CNG -> engine imported, usage log skipped |
| MOTORES A.p.CNG | AircraftEngineUsageLog.cycles | Conditional | Initial cycle snapshot at import date | Missing HRS/CNG -> engine imported, usage log skipped |
| MOTORES A.p.Fecha | AircraftEngineUsageLog.date | Conditional | Initial engine counter date | Invalid/missing date -> current date fallback + warning |
| MOTORES A.p.CTL | No persistent field (import warning only) | No | Currently captured as unresolved mapping warning | Pending domain decision |
| MOTORES A.p.RIN | No persistent field (import warning only) | No | Currently captured as unresolved mapping warning | Pending domain decision |
| TIPO | DueRow.sourceType | Yes | AD/SB/INSPECTION/MIM/DAN/COMPONENT/ENGINE_COMPONENT/MOD | Source classification may require rule tuning |
| ATA | MaintenanceTask.code, ComponentDefinition.ataCode, DueRow.category | Yes | Classification & grouping | None |
| AD / SB / DA / MOD code | MaintenanceTask.referenceNumber + referenceType, DueRow.sourceDocumentReference | Yes | Regulatory/source reference | DA semantics may map to DAN depending legacy usage |
| DESCRIPCION | MaintenanceTask.title / ComponentDefinition.name / DueRow.description | Yes | Operational row label | None |
| P/N | ComponentInstance.partNumber / Component.partNumber / DueRow.partNumber | Conditional | Only component rows | None |
| S/N | ComponentInstance.serialNumber / Component.serialNumber / DueRow.serialNumber | Conditional | Only component rows | None |
| MET | DueRow.method | Yes | H/M/C/N1/N2/LND/RIN | LND/RIN currently NO_CONTEXT when source absent |
| INTERVALO | DueRow.intervalValue + intervalUnit | Yes | Backend-calculated interval dimension | Multi-interval represented by DueRow.dimensions |
| CUMPL. | Compliance (real) performedAt + values / DueRow.lastCompliance* | Conditional | Baseline excluded as real compliance | If only baseline exists: control-start note |
| PROXIMO | Compliance.nextDue* / ComponentApplication.nextDue* / DueRow.nextDue* | Yes | Pre-calculated or derived by Due Engine | None |
| REMAN. | DueRow.remainingValue + remainingUnit | Yes | Calculated server-side from master counters / current date | None |
| OBS./REF. | Compliance.notes, WorkRequest.notes, DueRow.observations, sourceDocumentReference | No | Operational context and references | Free text may require standardization |
| APLICABLE | DueRow.isApplicable | Yes | Applicability state | Historical data may miss explicit applicability |
| CUMP. | DueRow.complianceType (REP/UNA_VEZ/AL_EVENTO) | Yes | Recurrence semantics | Legacy one-time logic may need per-task override |
| FECHA EF. | Compliance.performedAt / DueRow.lastComplianceDate | Conditional | Effective compliance date | None |

## Design Notes
- Frontend must not perform due arithmetic; all due/remanente values are backend-generated.
- Missing operational context is represented as NO_CONTEXT and rendered with neutral label.
- Baseline records are treated as control-start, not as real compliance.
- Real compliance always takes precedence over baseline when determining due context.
- Engine counters for N1/N2 are imported only from `AircraftEngineUsageLog`; when absent, Due Engine emits `NO_CONTEXT` for those dimensions.
