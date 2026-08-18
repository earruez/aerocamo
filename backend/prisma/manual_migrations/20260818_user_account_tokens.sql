-- Manual migration: confirmación de cuenta y reseteo de contraseña
-- Date: 2026-08-18

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS "emailConfirmedAt" TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "passwordResetTokenHash" VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS "passwordResetExpiresAt" TIMESTAMPTZ;

COMMIT;
