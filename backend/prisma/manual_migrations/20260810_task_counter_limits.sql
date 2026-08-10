-- Manual migration: per-counter limits on a task
-- Date: 2026-08-10
--
-- El límite de ciclos vivía en una sola columna de la tarea, así que solo cabía
-- uno. El Access tiene dos ranuras —LIMN1 y LIMN2— cuyo significado depende del
-- equipo: en el motor son CNG y CTL, en la aeronave LND y RIN. La segunda nunca
-- se importó, y con ella se perdieron seis límites de vida de piezas de turbina:
-- tres discos de potencia quedaron sin control de vencimiento alguno.
--
-- Una tarea puede tener varios límites, cada uno contra su contador. El mapeo
-- ranura → contador se resuelve por CounterType.slot, así que corregirlo es
-- cambiar una fila del catálogo y no volver a importar nada.

BEGIN;

ALTER TABLE counter_types
  ADD COLUMN IF NOT EXISTS slot smallint;

-- Mapeo por defecto, con el respaldo del manual ARRIEL: las piezas de turbina
-- libre se limitan en ciclos de turbina libre, que es la segunda ranura.
UPDATE counter_types SET slot = 1 WHERE upper(code) = 'LND' AND slot IS NULL;
UPDATE counter_types SET slot = 2 WHERE upper(code) = 'RIN' AND slot IS NULL;
UPDATE counter_types SET slot = 1 WHERE upper(code) = 'CNG' AND slot IS NULL;
UPDATE counter_types SET slot = 2 WHERE upper(code) = 'CTL' AND slot IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS counter_types_scope_slot_uq
  ON counter_types ("organizationId", scope, slot)
  WHERE slot IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_counter_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "taskId" uuid NOT NULL,

  -- Ranura de origen en el Access; el contador concreto se resuelve por el
  -- catálogo, de modo que reinterpretarla no exige volver a migrar.
  slot smallint NOT NULL,
  "limitValue" numeric(12, 2) NOT NULL,
  -- Lectura del contador en el último cumplimiento
  "lastValue" numeric(12, 2),

  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT task_counter_limits_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT task_counter_limits_task_fk
    FOREIGN KEY ("taskId") REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
  CONSTRAINT task_counter_limits_slot_chk CHECK (slot IN (1, 2))
);

CREATE UNIQUE INDEX IF NOT EXISTS task_counter_limits_task_slot_uq
  ON task_counter_limits ("taskId", slot);

COMMIT;
