-- Manual migration: track whether the email actually left
-- Date: 2026-08-10
--
-- dispatchMethod dice cómo se decidió enviar la ST, no si el correo salió. Sin
-- SMTP configurado —o si el servidor de correo rechaza— la solicitud quedaría
-- marcada como enviada por correo sin que el taller haya recibido nada. Se
-- guarda la hora real del envío y a qué dirección, para que la diferencia entre
-- "registrado" y "entregado" quede en el expediente.

BEGIN;

ALTER TABLE work_requests
  ADD COLUMN IF NOT EXISTS "emailSentAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "emailSentTo" varchar(255);

COMMIT;
