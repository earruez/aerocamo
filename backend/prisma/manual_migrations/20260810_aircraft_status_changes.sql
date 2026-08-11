-- Manual migration: aircraft status change log
-- Date: 2026-08-10
--
-- El estado operacional se cambiaba solo por importación: no había pantalla ni
-- automatismo que lo moviera. Sacar una aeronave de servicio o devolverla es una
-- decisión de aeronavegabilidad, así que queda registrada con su motivo y su
-- autor — el estado actual dice dónde está la aeronave, y este historial dice
-- por qué y desde cuándo.

BEGIN;

CREATE TABLE IF NOT EXISTS aircraft_status_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "aircraftId" uuid NOT NULL,

  "fromStatus" aircraft_status,
  "toStatus" aircraft_status NOT NULL,
  reason text NOT NULL,

  "changedById" uuid,
  "changedAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT aircraft_status_changes_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT aircraft_status_changes_aircraft_fk
    FOREIGN KEY ("aircraftId") REFERENCES aircraft(id) ON DELETE CASCADE,
  CONSTRAINT aircraft_status_changes_changed_by_fk
    FOREIGN KEY ("changedById") REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS aircraft_status_changes_aircraft_idx
  ON aircraft_status_changes ("aircraftId", "changedAt" DESC);

COMMIT;
