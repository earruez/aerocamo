-- Manual migration: persist assigned maintenance plans by aircraft category
-- Date: 2026-04-20

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assigned_plan_category') THEN
    CREATE TYPE assigned_plan_category AS ENUM (
      'manufacturer',
      'national_dgac',
      'engine_components',
      'origin_country'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS aircraft_assigned_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "aircraftId" uuid NOT NULL,
  category assigned_plan_category NOT NULL,
  "templateId" uuid NOT NULL,
  "assignedById" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT aircraft_assigned_plans_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id)
    ON DELETE CASCADE,
  CONSTRAINT aircraft_assigned_plans_aircraft_fk
    FOREIGN KEY ("aircraftId") REFERENCES aircraft(id)
    ON DELETE CASCADE,
  CONSTRAINT aircraft_assigned_plans_template_fk
    FOREIGN KEY ("templateId") REFERENCES maintenance_templates(id)
    ON DELETE RESTRICT,
  CONSTRAINT aircraft_assigned_plans_assigned_by_fk
    FOREIGN KEY ("assignedById") REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS aircraft_assigned_plans_aircraft_category_uidx
  ON aircraft_assigned_plans ("aircraftId", category);

CREATE INDEX IF NOT EXISTS aircraft_assigned_plans_org_aircraft_idx
  ON aircraft_assigned_plans ("organizationId", "aircraftId");

CREATE INDEX IF NOT EXISTS aircraft_assigned_plans_template_idx
  ON aircraft_assigned_plans ("templateId");

COMMIT;
