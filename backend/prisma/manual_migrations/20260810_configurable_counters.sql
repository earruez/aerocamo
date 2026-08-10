-- Manual migration: configurable counters (Access TN model)
-- Date: 2026-08-10
--
-- La plataforma llevaba dos contadores fijos por equipo —horas y ciclos— pero la
-- operación usa tres o más y no son intercambiables: en la aeronave HRS, LND y
-- RIN; en el motor HRS, CNG (ciclos generador de gas) y CTL (ciclos turbina
-- libre). CNG y CTL avanzan a ritmos distintos según el perfil de vuelo y hay
-- componentes con vida limitada contra uno u otro, así que meterlos en el mismo
-- campo pierde información.
--
-- El catálogo replica la tabla TN del Access: la organización declara los
-- contadores que usa y registra lecturas contra cada uno.

BEGIN;

CREATE TABLE IF NOT EXISTS counter_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,

  -- Código corto tal como se usa en la operación: CNG, CTL, LND, RIN…
  code varchar(20) NOT NULL,
  name varchar(120) NOT NULL,
  -- Cómo se expresa la lectura: horas, ciclos, aterrizajes…
  unit varchar(30) NOT NULL DEFAULT 'ciclos',
  -- A qué equipo aplica
  scope varchar(12) NOT NULL DEFAULT 'BOTH',
  -- Los contadores que ya existían como campo fijo, para no duplicar la verdad
  "legacyField" varchar(30),
  "isActive" boolean NOT NULL DEFAULT true,
  "sortOrder" integer NOT NULL DEFAULT 100,

  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT counter_types_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT counter_types_scope_chk CHECK (scope IN ('AIRCRAFT', 'ENGINE', 'BOTH')),
  CONSTRAINT counter_types_legacy_chk
    CHECK ("legacyField" IS NULL OR "legacyField" IN ('aircraftHours', 'aircraftCycles', 'engineHours', 'engineCycles'))
);

CREATE UNIQUE INDEX IF NOT EXISTS counter_types_org_code_uq
  ON counter_types ("organizationId", upper(code));

CREATE TABLE IF NOT EXISTS counter_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "counterTypeId" uuid NOT NULL,

  -- Exactamente uno de los dos: la lectura es de la aeronave o de un motor
  "aircraftId" uuid,
  "engineId" uuid,

  value numeric(12, 2) NOT NULL,
  "readingDate" date NOT NULL,
  source varchar(30) NOT NULL DEFAULT 'manual',
  notes text,

  "recordedById" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT counter_readings_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT counter_readings_type_fk
    FOREIGN KEY ("counterTypeId") REFERENCES counter_types(id) ON DELETE CASCADE,
  CONSTRAINT counter_readings_aircraft_fk
    FOREIGN KEY ("aircraftId") REFERENCES aircraft(id) ON DELETE CASCADE,
  CONSTRAINT counter_readings_engine_fk
    FOREIGN KEY ("engineId") REFERENCES aircraft_engines(id) ON DELETE CASCADE,
  CONSTRAINT counter_readings_recorded_by_fk
    FOREIGN KEY ("recordedById") REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT counter_readings_target_chk
    CHECK (("aircraftId" IS NOT NULL) <> ("engineId" IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS counter_readings_aircraft_idx
  ON counter_readings ("aircraftId", "counterTypeId", "readingDate" DESC);
CREATE INDEX IF NOT EXISTS counter_readings_engine_idx
  ON counter_readings ("engineId", "counterTypeId", "readingDate" DESC);

COMMIT;
