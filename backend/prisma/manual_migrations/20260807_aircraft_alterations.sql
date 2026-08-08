-- Manual migration: aircraft alterations (STC / Form DGAC 337)
-- Date: 2026-08-07
--
-- Las alteraciones son modificaciones aprobadas a la configuración de la aeronave
-- (STC, Formulario DGAC 337) y son parte del expediente de aeronavegabilidad:
-- cada una tiene documento de aprobación, fecha, y si trajo suplemento de manual
-- de vuelo (FMS) e instrucciones de aeronavegabilidad continuada (ICA).
-- Hasta ahora la pantalla de "Alteraciones" mostraba movimientos de componentes,
-- que son otra cosa.

BEGIN;

CREATE TABLE IF NOT EXISTS aircraft_alterations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "aircraftId" uuid NOT NULL,

  -- Documento que aprueba la alteración (p. ej. "Form DGAC 337 N° 307-2010")
  "documentNumber" varchar(255) NOT NULL,
  description text NOT NULL,
  "approvalDate" date,

  -- Suplemento del manual de vuelo asociado
  "hasFlightManualSupplement" boolean NOT NULL DEFAULT false,
  "flightManualReference" varchar(255),

  -- Instrucciones de aeronavegabilidad continuada asociadas
  "hasIca" boolean NOT NULL DEFAULT false,
  "icaReference" varchar(255),

  -- OT / taller donde se ejecutó
  reference varchar(255),
  notes text,

  "createdById" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT aircraft_alterations_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT aircraft_alterations_aircraft_fk
    FOREIGN KEY ("aircraftId") REFERENCES aircraft(id) ON DELETE CASCADE,
  CONSTRAINT aircraft_alterations_created_by_fk
    FOREIGN KEY ("createdById") REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS aircraft_alterations_aircraft_idx
  ON aircraft_alterations ("aircraftId");
CREATE INDEX IF NOT EXISTS aircraft_alterations_organization_idx
  ON aircraft_alterations ("organizationId");

-- Evita duplicar la misma alteración al reimportar desde Access
CREATE UNIQUE INDEX IF NOT EXISTS aircraft_alterations_aircraft_document_uq
  ON aircraft_alterations ("aircraftId", "documentNumber");

COMMIT;
