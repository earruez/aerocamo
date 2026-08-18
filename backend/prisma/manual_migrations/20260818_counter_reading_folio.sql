-- Manual migration: folio correlativo de bitácora física en las lecturas de contador
-- Date: 2026-08-18

BEGIN;

ALTER TABLE counter_readings ADD COLUMN IF NOT EXISTS "folio" VARCHAR(50);

COMMIT;
