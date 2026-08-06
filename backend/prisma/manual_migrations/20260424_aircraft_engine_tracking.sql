-- Manual migration: aircraft engine tracking and usage logs
-- Date: 2026-04-24

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aircraft_engine_position') THEN
    CREATE TYPE aircraft_engine_position AS ENUM ('N1', 'N2');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS aircraft_engines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "aircraftId" uuid NOT NULL,
  position aircraft_engine_position NOT NULL,
  manufacturer varchar(150) NOT NULL,
  model varchar(150) NOT NULL,
  "serialNumber" varchar(100) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT aircraft_engines_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id)
    ON DELETE CASCADE,
  CONSTRAINT aircraft_engines_aircraft_fk
    FOREIGN KEY ("aircraftId") REFERENCES aircraft(id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS aircraft_engines_aircraft_position_uidx
  ON aircraft_engines ("aircraftId", position);

CREATE INDEX IF NOT EXISTS aircraft_engines_org_aircraft_idx
  ON aircraft_engines ("organizationId", "aircraftId");

CREATE INDEX IF NOT EXISTS aircraft_engines_org_serial_idx
  ON aircraft_engines ("organizationId", "serialNumber");

CREATE TABLE IF NOT EXISTS aircraft_engine_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "engineId" uuid NOT NULL,
  hours numeric(10,2) NOT NULL,
  cycles integer NOT NULL,
  "date" date NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT aircraft_engine_usage_logs_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id)
    ON DELETE CASCADE,
  CONSTRAINT aircraft_engine_usage_logs_engine_fk
    FOREIGN KEY ("engineId") REFERENCES aircraft_engines(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS aircraft_engine_usage_logs_org_engine_date_idx
  ON aircraft_engine_usage_logs ("organizationId", "engineId", "date");

COMMIT;
