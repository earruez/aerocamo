-- Permite reemplazar un motor: el motor retirado se conserva (isActive=false,
-- con su historial intacto) y se crea uno nuevo en la misma posición. Para
-- eso hay que dejar de exigir un solo motor por (aeronave, posición) a
-- secas, y exigir en cambio un solo motor ACTIVO por (aeronave, posición).
BEGIN;

ALTER TABLE aircraft_engines ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE aircraft_engines ADD COLUMN IF NOT EXISTS "removedAt" TIMESTAMPTZ;
ALTER TABLE aircraft_engines ADD COLUMN IF NOT EXISTS "removalReason" TEXT;

DROP INDEX IF EXISTS aircraft_engines_aircraftId_position_key;
DROP INDEX IF EXISTS "aircraft_engines_aircraftId_position_key";
DROP INDEX IF EXISTS aircraft_engines_aircraft_position_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS aircraft_engines_active_position_uidx
  ON aircraft_engines ("aircraftId", position)
  WHERE "isActive" = true;

COMMIT;
