-- Manual migration: applicability notes on aircraft-task links
-- Date: 2026-08-07
--
-- Marcar una tarea como "no aplica" es una decisión de aeronavegabilidad que debe
-- quedar justificada y auditable ("N/A, aeronave nueva", "SUPERSEDED BY EASA AD
-- 2006-0095", "no aplica por ambiente salino"). Además la no aplicabilidad puede
-- ser reversible: una tarea descartada por el ambiente de operación vuelve a
-- aplicar si la aeronave cambia de base, por eso el vínculo nunca se borra.

BEGIN;

ALTER TABLE aircraft_tasks
  ADD COLUMN IF NOT EXISTS "applicabilityNotes" text,
  ADD COLUMN IF NOT EXISTS "applicabilityChangedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "applicabilityChangedById" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'aircraft_tasks_applicability_changed_by_fk'
  ) THEN
    ALTER TABLE aircraft_tasks
      ADD CONSTRAINT aircraft_tasks_applicability_changed_by_fk
      FOREIGN KEY ("applicabilityChangedById") REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS aircraft_tasks_is_active_idx
  ON aircraft_tasks ("aircraftId", "isActive");

COMMIT;
