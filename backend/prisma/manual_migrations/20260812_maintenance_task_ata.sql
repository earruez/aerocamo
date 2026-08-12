-- Manual migration: maintenance_tasks.ata (safe/idempotent)
-- Date: 2026-08-12
--
-- El capítulo ATA no tenía columna propia; el script de importación del
-- Access ya lo leía (campo ATA del CSV) pero lo guardaba en referenceNumber
-- por falta de un lugar mejor. Esta columna le da un lugar propio.

BEGIN;

ALTER TABLE maintenance_tasks
  ADD COLUMN IF NOT EXISTS "ata" VARCHAR(20);

COMMIT;
