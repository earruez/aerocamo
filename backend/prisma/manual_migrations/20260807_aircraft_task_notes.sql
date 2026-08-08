-- Manual migration: free-form notes on an aircraft task
-- Date: 2026-08-07
--
-- Hasta ahora la única puerta a una observación era registrar un cumplimiento,
-- que exige ST vigente y OT firmada. Eso deja sin registrar el trabajo de
-- revisión: consultar una AD y concluir que sigue vigente, anotar que se pidió
-- información al fabricante, o dejar constancia de un seguimiento. Estas notas
-- son bitácora, no cumplimiento: no mueven vencimientos ni estado de la tarea.

BEGIN;

CREATE TABLE IF NOT EXISTS aircraft_task_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "aircraftId" uuid NOT NULL,
  "taskId" uuid NOT NULL,

  note text NOT NULL,

  "createdById" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT aircraft_task_notes_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT aircraft_task_notes_aircraft_fk
    FOREIGN KEY ("aircraftId") REFERENCES aircraft(id) ON DELETE CASCADE,
  CONSTRAINT aircraft_task_notes_task_fk
    FOREIGN KEY ("taskId") REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
  CONSTRAINT aircraft_task_notes_created_by_fk
    FOREIGN KEY ("createdById") REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS aircraft_task_notes_aircraft_task_idx
  ON aircraft_task_notes ("aircraftId", "taskId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS aircraft_task_notes_organization_idx
  ON aircraft_task_notes ("organizationId");

COMMIT;
