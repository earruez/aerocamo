-- Manual migration: track the WhatsApp notification
-- Date: 2026-08-10
--
-- Mismo criterio que el correo: guardar si el aviso salió de verdad y a qué
-- número, para que "se notificó" no sea una suposición. WhatsApp cobra por
-- mensaje y exige plantilla aprobada, así que el fallo debe quedar visible.

BEGIN;

ALTER TABLE work_requests
  ADD COLUMN IF NOT EXISTS "whatsappSentAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "whatsappSentTo" varchar(40);

COMMIT;
