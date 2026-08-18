-- Manual migration: allow multiple maintenance plan templates per category per aircraft
-- Date: 2026-08-18

BEGIN;

DROP INDEX IF EXISTS aircraft_assigned_plans_aircraft_category_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS aircraft_assigned_plans_aircraft_category_template_uidx
  ON aircraft_assigned_plans ("aircraftId", category, "templateId");

COMMIT;
