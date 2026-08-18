-- Manual migration: drop leftover Prisma-default-named unique constraint on
-- (aircraftId, category) that predates the custom-named index and was not
-- caught by 20260818_aircraft_assigned_plan_multi.sql
-- Date: 2026-08-18

BEGIN;

DROP INDEX IF EXISTS "aircraft_assigned_plans_aircraftId_category_key";

COMMIT;
