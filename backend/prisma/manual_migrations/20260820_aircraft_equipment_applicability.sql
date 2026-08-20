-- Manual migration: aplicabilidad de equipos de la lista DGAC por aeronave
-- Date: 2026-08-20
--
-- La DGAC numera el estatus de cumplimiento por equipo (IV.2.1 Aeronave,
-- IV.2.2 Motor 1, IV.2.4 Hélice 1, IV.2.6 APU, etc.). El informe recorre los
-- seis puntos y declara "No aplica" los que no corresponden, porque un punto
-- omitido no deja constancia de que se evaluó.
--
-- Hasta ahora ese "No aplica" lo afirmaba el código: para hélice y APU decía
-- "la plataforma no registra este equipo", que no es lo mismo que "no
-- corresponde" y puede leerse como que faltan datos por cargar. Esta tabla
-- convierte esa afirmación en una declaración con motivo, fecha y responsable,
-- igual que la aplicabilidad de tareas en aircraft_tasks.
--
-- Los motores NO necesitan declararse: el informe los deriva de las posiciones
-- N1/N2 realmente registradas en aircraft_engines, y eso es preferible porque
-- no puede quedar desactualizado. La tabla los admite igual por si hay que
-- excluir un motor instalado por una razón que el dato no captura.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dgac_equipment') THEN
    CREATE TYPE dgac_equipment AS ENUM (
      'AERONAVE', 'MOTOR_1', 'MOTOR_2', 'HELICE_1', 'HELICE_2', 'APU'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS aircraft_equipment_applicability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "aircraftId" uuid NOT NULL,
  equipment dgac_equipment NOT NULL,

  applies boolean NOT NULL,
  notes text,
  "changedAt" timestamptz NOT NULL DEFAULT now(),
  "changedById" uuid,

  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT aircraft_equipment_applicability_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT aircraft_equipment_applicability_aircraft_fk
    FOREIGN KEY ("aircraftId") REFERENCES aircraft(id) ON DELETE CASCADE,
  CONSTRAINT aircraft_equipment_applicability_changed_by_fk
    FOREIGN KEY ("changedById") REFERENCES users(id) ON DELETE SET NULL
);

-- Una sola declaración vigente por equipo y aeronave: la decisión se actualiza,
-- no se acumula.
CREATE UNIQUE INDEX IF NOT EXISTS aircraft_equipment_applicability_unique
  ON aircraft_equipment_applicability ("aircraftId", equipment);

CREATE INDEX IF NOT EXISTS aircraft_equipment_applicability_org_aircraft_idx
  ON aircraft_equipment_applicability ("organizationId", "aircraftId");

COMMIT;
