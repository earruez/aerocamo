-- Manual migration: compliances.applicationType / isInitial (safe/idempotent)
-- Date: 2026-08-11
--
-- Estas dos columnas existen en la base local desde hace tiempo (el modelo
-- Compliance de schema.prisma las declara) pero nunca quedaron en una
-- migración: la única migración que crea el enum compliance_application_type
-- (20260420_component_tracking_backend_model.sql) solo lo usó en
-- component_applications, no en compliances. Esto deja producción sin la
-- columna hasta correr esta migración.

BEGIN;

-- El enum ya existe (creado por 20260420_component_tracking_backend_model.sql).
-- Si por algún motivo se aplica esta migración antes que esa, lo creamos igual.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t WHERE t.typname = 'compliance_application_type'
  ) THEN
    CREATE TYPE compliance_application_type AS ENUM ('baseline', 'application', 'replacement_start');
  END IF;
END
$$;

ALTER TABLE compliances
  ADD COLUMN IF NOT EXISTS "applicationType" compliance_application_type NOT NULL DEFAULT 'application';

ALTER TABLE compliances
  ADD COLUMN IF NOT EXISTS "isInitial" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "compliances_organizationId_applicationType_idx"
  ON compliances ("organizationId", "applicationType");

COMMIT;
