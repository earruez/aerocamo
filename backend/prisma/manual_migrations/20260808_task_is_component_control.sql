-- Manual migration: explicit flag for component life control
-- Date: 2026-08-08
--
-- Hasta ahora "esta tarea es control de componente" se deducía de tener P/N
-- aplicable. Eso dejaba fuera controles reales que en el Access no traen P/N
-- —el TAIL ROTOR CONTROL ROD de CC-DLD tiene límite de 20000 FH / 240 M y
-- ningún P/N— que no aparecían en la página de Componentes ni podían separarse
-- del plan. El dominio COMP del Access es el dato verdadero, así que se guarda
-- explícitamente en vez de inferirlo.

BEGIN;

ALTER TABLE maintenance_tasks
  ADD COLUMN IF NOT EXISTS "isComponentControl" boolean NOT NULL DEFAULT false;

-- Backfill: las tareas importadas del dominio COMP llevan el prefijo en su código.
UPDATE maintenance_tasks
   SET "isComponentControl" = true
 WHERE upper(code) LIKE 'COMP-%'
   AND "isComponentControl" = false;

CREATE INDEX IF NOT EXISTS maintenance_tasks_component_control_idx
  ON maintenance_tasks ("organizationId", "isComponentControl");

COMMIT;
