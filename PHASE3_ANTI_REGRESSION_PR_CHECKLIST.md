# PR Checklist - ST/OT Execution Eligibility (Phase 3)

## Mandatory Anti-Regression Checks

### Backend

- [ ] All compliance/replacement paths validate eligibility in backend
- [ ] No direct persistence bypassing WorkRequestExecutionEligibilityService
- [ ] WorkRequestItem metadata is fully set:
  - [ ] sourceKind
  - [ ] sourceId
  - [ ] executionType
- [ ] ST status is validated (no draft/open bypass)
- [ ] OT validity is enforced (state + evidence)
- [ ] Invalid eligibility returns explicit error (no silent fallback)

---

### Frontend

- [ ] No local eligibility logic implemented
- [ ] No OT auto-selection or inference in UI
- [ ] Execution flows always call backend eligibility endpoint
- [ ] Eligible OT comes from backend and is treated as readonly
- [ ] No UI path bypasses eligibility check
- [ ] Loading/error states block execution (no silent enable)

---

### Data Integrity

- [ ] No new flow creates ST items without execution metadata
- [ ] No adapter invents missing metadata
- [ ] All item creation paths include:
  - [ ] sourceKind
  - [ ] sourceId
  - [ ] executionType

---

### Red Flags (MUST BE FALSE)

- [ ] No hardcoded eligibility rules in frontend
- [ ] No fallback OT selection
- [ ] No direct DB/use-case write skipping eligibility validation
- [ ] No temporary bypass logic

---

## Final Guarantee

- [ ] Backend decides eligibility
- [ ] Frontend only consumes result
- [ ] No way to execute compliance/replacement if backend rejects

---

## Integration Test Note (Phase 3)

- Dedicated command: `npm run test:integration:eligibility` (from `backend/`).
- This suite requires a real PostgreSQL `DATABASE_URL`.
- It is intentionally gated with `RUN_DB_INTEGRATION_TESTS=1` to avoid accidental execution in environments without DB credentials.
- It validates backend anti-bypass execution eligibility for ST/OT compliance flows.

---

## Notes (optional)

<!-- Describe any edge cases or decisions -->
