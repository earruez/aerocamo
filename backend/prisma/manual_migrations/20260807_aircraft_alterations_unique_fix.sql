-- Manual migration: fix alteration uniqueness key
-- Date: 2026-08-07
--
-- Un mismo documento de aprobación puede amparar varias alteraciones distintas:
-- el Formulario DGAC 337 N° 391-2020 aprueba tres modificaciones separadas
-- (LEO Activation, Sacksafoam, Loudspeaker). Con la clave (aeronave, documento)
-- esas filas se pisaban entre sí, así que la identidad incluye la descripción.

BEGIN;

DROP INDEX IF EXISTS aircraft_alterations_aircraft_document_uq;

CREATE UNIQUE INDEX IF NOT EXISTS aircraft_alterations_identity_uq
  ON aircraft_alterations ("aircraftId", "documentNumber", md5(description));

COMMIT;
