-- Manual migration: aircraft usage history (safe/idempotent)
-- Date: 2026-04-15

BEGIN;

-- Ensure gen_random_uuid() is available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Create enum type if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'aircraft_usage_source'
  ) THEN
    CREATE TYPE aircraft_usage_source AS ENUM (
      'manual',
      'flight_log',
      'ot_close',
      'import',
      'baseline'
    );
  END IF;
END
$$;

-- 2) Create table if missing
CREATE TABLE IF NOT EXISTS aircraft_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "aircraftId" uuid NOT NULL,
  "date" date NOT NULL,
  "totalHours" numeric(10,2) NOT NULL,
  "totalCycles" integer NOT NULL,
  "source" aircraft_usage_source NOT NULL,
  notes text NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT aircraft_usage_logs_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id)
    ON DELETE CASCADE,
  CONSTRAINT aircraft_usage_logs_aircraft_fk
    FOREIGN KEY ("aircraftId") REFERENCES aircraft(id)
    ON DELETE CASCADE
);

-- 3) Index to match Prisma schema intent
CREATE INDEX IF NOT EXISTS aircraft_usage_logs_org_aircraft_date_idx
  ON aircraft_usage_logs ("organizationId", "aircraftId", "date");

-- 4) Backfill baseline rows for aircraft without usage history
INSERT INTO aircraft_usage_logs (
  id,
  "organizationId",
  "aircraftId",
  "date",
  "totalHours",
  "totalCycles",
  "source",
  notes,
  "createdAt"
)
SELECT
  gen_random_uuid(),
  a."organizationId",
  a.id,
  COALESCE(a."createdAt"::date, CURRENT_DATE),
  COALESCE(a."totalFlightHours", 0),
  COALESCE(a."totalCycles", 0),
  'baseline'::aircraft_usage_source,
  'Registro inicial de aeronave',
  now()
FROM aircraft a
WHERE NOT EXISTS (
  SELECT 1
  FROM aircraft_usage_logs l
  WHERE l."aircraftId" = a.id
    AND l."organizationId" = a."organizationId"
);

COMMIT;
