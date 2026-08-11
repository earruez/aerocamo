-- Manual migration: compliance recurrence on maintenance tasks
-- Date: 2026-08-07
--
-- Access marca la recurrencia de cada ítem en la columna REP (REP, UNA VEZ,
-- UNICA VEZ, COND, A REQ., AL EVENTO, PERM/PERMANENTE, OPEN). Es el criterio con
-- el que el usuario separa las AD repetitivas —las que vuelven a vencer— de las
-- de cumplimiento único, y sin persistirlo no se puede filtrar por ello.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'compliance_recurrence') THEN
    CREATE TYPE compliance_recurrence AS ENUM (
      'REPETITIVE',
      'ONE_TIME',
      'ON_CONDITION',
      'ON_EVENT',
      'PERMANENT',
      'UNSPECIFIED'
    );
  END IF;
END
$$;

ALTER TABLE maintenance_tasks
  ADD COLUMN IF NOT EXISTS "complianceRecurrence" compliance_recurrence NOT NULL DEFAULT 'UNSPECIFIED';

CREATE INDEX IF NOT EXISTS maintenance_tasks_compliance_recurrence_idx
  ON maintenance_tasks ("complianceRecurrence", "organizationId");

COMMIT;
