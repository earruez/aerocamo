-- Manual migration: owner and year of manufacture on the aircraft
-- Date: 2026-08-11
--
-- La ficha del Access lleva propietario y año de fabricación y la plataforma no
-- tenía dónde ponerlos. El año se guarda como número y no como fecha: el Access
-- solo registra el año, y una fecha inventada al 1 de enero aparentaría una
-- precisión que el dato no tiene.
--
-- El vencimiento del certificado de aeronavegabilidad (FVEN) va al campo que ya
-- existía, coaExpiryDate.

BEGIN;

ALTER TABLE aircraft
  ADD COLUMN IF NOT EXISTS owner varchar(180),
  ADD COLUMN IF NOT EXISTS "yearManufactured" smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aircraft_year_manufactured_chk') THEN
    ALTER TABLE aircraft ADD CONSTRAINT aircraft_year_manufactured_chk
      CHECK ("yearManufactured" IS NULL OR "yearManufactured" BETWEEN 1900 AND 2200);
  END IF;
END
$$;

COMMIT;
