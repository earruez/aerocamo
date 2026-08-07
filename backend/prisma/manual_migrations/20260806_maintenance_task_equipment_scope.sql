-- Manual migration: equipment scope on maintenance tasks (aircraft vs engine)
-- Date: 2026-08-06
--
-- El control de mantenimiento distingue entre lo que pertenece a la célula de la
-- aeronave y lo que pertenece al motor (en Access son las vistas COMP y COMP1,
-- resueltas por EQ.TIP = AN / EN1). Sin este dato ambos se mezclan en una sola
-- lista y no se pueden separar para revisión ni reporte.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'equipment_scope') THEN
    CREATE TYPE equipment_scope AS ENUM ('AIRCRAFT', 'ENGINE');
  END IF;
END
$$;

ALTER TABLE maintenance_tasks
  ADD COLUMN IF NOT EXISTS "equipmentScope" equipment_scope NOT NULL DEFAULT 'AIRCRAFT';

CREATE INDEX IF NOT EXISTS maintenance_tasks_equipment_scope_idx
  ON maintenance_tasks ("equipmentScope", "organizationId");

COMMIT;
