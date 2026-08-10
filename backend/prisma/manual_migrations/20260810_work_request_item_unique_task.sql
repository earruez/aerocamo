-- Manual migration: one row per task inside a work request
-- Date: 2026-08-10
--
-- El job de generación automática insertaba con createMany({ skipDuplicates: true }),
-- pero skipDuplicates solo omite filas que chocan con una restricción única y la
-- tabla no tenía ninguna. Cada arranque del servidor volvía a agregar las mismas
-- tareas al borrador: la ST-2026-0007 llegó a 632 ítems para 29 tareas distintas.
--
-- La regla vive en la base y no solo en el job, para que ninguna vía —ni el job,
-- ni "Agregar item", ni un import— pueda repetir una tarea dentro de una misma
-- solicitud. Es índice parcial porque hay ítems de componente o discrepancia sin
-- tarea asociada, y esos no deben quedar sujetos a la restricción.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS work_request_items_request_task_uq
  ON work_request_items ("workRequestId", "taskId")
  WHERE "taskId" IS NOT NULL;

COMMIT;
