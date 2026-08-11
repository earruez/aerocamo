-- Manual migration: counter slots declared per equipment
-- Date: 2026-08-10
--
-- El mapeo ranura → contador se había puesto a nivel de organización asumiendo
-- que era una convención fija. No lo es: la tabla EQ del Access lo declara por
-- equipo y varía. La ranura 1 de la célula es LND en cinco aeronaves y CY en
-- cuatro; la ranura 2 del motor es CTL en cuatro y CNF en tres —los ARRIEL 2D
-- y 2B—. Un mapeo único acertaba en unos equipos y erraba en otros.
--
-- La ranura es posicional: el límite guardado en LIMN2 se mide contra la ranura
-- 2 de ese equipo, se llame como se llame. Por eso esto se puede resolver sin
-- decidir qué significa cada sigla.

BEGIN;

CREATE TABLE IF NOT EXISTS equipment_counter_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,

  -- Exactamente uno de los dos, igual que en las lecturas
  "aircraftId" uuid,
  "engineId" uuid,

  slot smallint NOT NULL,
  "counterTypeId" uuid NOT NULL,

  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT equipment_counter_slots_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT equipment_counter_slots_aircraft_fk
    FOREIGN KEY ("aircraftId") REFERENCES aircraft(id) ON DELETE CASCADE,
  CONSTRAINT equipment_counter_slots_engine_fk
    FOREIGN KEY ("engineId") REFERENCES aircraft_engines(id) ON DELETE CASCADE,
  CONSTRAINT equipment_counter_slots_type_fk
    FOREIGN KEY ("counterTypeId") REFERENCES counter_types(id) ON DELETE CASCADE,
  CONSTRAINT equipment_counter_slots_target_chk
    CHECK (("aircraftId" IS NOT NULL) <> ("engineId" IS NOT NULL)),
  CONSTRAINT equipment_counter_slots_slot_chk CHECK (slot IN (1, 2))
);

CREATE UNIQUE INDEX IF NOT EXISTS equipment_counter_slots_aircraft_uq
  ON equipment_counter_slots ("aircraftId", slot) WHERE "aircraftId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS equipment_counter_slots_engine_uq
  ON equipment_counter_slots ("engineId", slot) WHERE "engineId" IS NOT NULL;

COMMIT;
