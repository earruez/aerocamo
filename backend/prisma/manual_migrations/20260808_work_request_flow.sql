-- Manual migration: shop contacts, review step and received work order
-- Date: 2026-08-08
--
-- Tres huecos del módulo de Solicitud de Trabajo:
--
-- 1. La ST se enviaba a un usuario de la propia organización, pero quien recibe
--    el trabajo es una persona del taller (CMA). Se necesitan sus contactos.
-- 2. El ciclo real tiene revisión antes de salir y recepción de la OT al volver;
--    el enum solo cubría DRAFT/SENT/CANCELLED, así que el cierre se anotaba como
--    texto libre dentro de las notas y no se podía listar ni filtrar.
-- 3. "Registrar OT recibida" solo vivía en el estado de React: número y fecha de
--    la OT se perdían al recargar la página.

BEGIN;

-- ── 1. Personas de contacto en el taller ────────────────────────────────────
CREATE TABLE IF NOT EXISTS repair_shop_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "repairShopId" uuid NOT NULL,

  name varchar(180) NOT NULL,
  role varchar(120),
  email varchar(255),
  phone varchar(60),
  "isPrimary" boolean NOT NULL DEFAULT false,
  "isActive" boolean NOT NULL DEFAULT true,

  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT repair_shop_contacts_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT repair_shop_contacts_shop_fk
    FOREIGN KEY ("repairShopId") REFERENCES repair_shops(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS repair_shop_contacts_shop_idx
  ON repair_shop_contacts ("repairShopId", "isActive");

-- ── 2. Nuevos estados del ciclo ─────────────────────────────────────────────
ALTER TYPE work_request_status ADD VALUE IF NOT EXISTS 'IN_REVIEW' BEFORE 'SENT';
ALTER TYPE work_request_status ADD VALUE IF NOT EXISTS 'OT_RECEIVED' AFTER 'SENT';
ALTER TYPE work_request_status ADD VALUE IF NOT EXISTS 'CLOSED' AFTER 'OT_RECEIVED';

COMMIT;

BEGIN;

-- ── 3. Revisión, destino y OT recibida ──────────────────────────────────────
ALTER TABLE work_requests
  -- Quién revisa la ST antes de que salga
  ADD COLUMN IF NOT EXISTS "reviewerId" uuid,
  ADD COLUMN IF NOT EXISTS "reviewedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "reviewNotes" text,

  -- A qué taller y a qué persona se envió, y por qué vía
  ADD COLUMN IF NOT EXISTS "repairShopId" uuid,
  ADD COLUMN IF NOT EXISTS "repairShopContactId" uuid,
  ADD COLUMN IF NOT EXISTS "dispatchMethod" varchar(20),
  ADD COLUMN IF NOT EXISTS "dispatchNotes" text,

  -- OT que devuelve el taller
  ADD COLUMN IF NOT EXISTS "otNumber" varchar(80),
  ADD COLUMN IF NOT EXISTS "otReceivedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "otDocumentUrl" text,
  ADD COLUMN IF NOT EXISTS "otRegisteredById" uuid,

  ADD COLUMN IF NOT EXISTS "closedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "closedById" uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_requests_reviewer_fk') THEN
    ALTER TABLE work_requests ADD CONSTRAINT work_requests_reviewer_fk
      FOREIGN KEY ("reviewerId") REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_requests_repair_shop_fk') THEN
    ALTER TABLE work_requests ADD CONSTRAINT work_requests_repair_shop_fk
      FOREIGN KEY ("repairShopId") REFERENCES repair_shops(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_requests_repair_shop_contact_fk') THEN
    ALTER TABLE work_requests ADD CONSTRAINT work_requests_repair_shop_contact_fk
      FOREIGN KEY ("repairShopContactId") REFERENCES repair_shop_contacts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_requests_ot_registered_by_fk') THEN
    ALTER TABLE work_requests ADD CONSTRAINT work_requests_ot_registered_by_fk
      FOREIGN KEY ("otRegisteredById") REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_requests_closed_by_fk') THEN
    ALTER TABLE work_requests ADD CONSTRAINT work_requests_closed_by_fk
      FOREIGN KEY ("closedById") REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_requests_dispatch_method_chk') THEN
    ALTER TABLE work_requests ADD CONSTRAINT work_requests_dispatch_method_chk
      CHECK ("dispatchMethod" IS NULL OR "dispatchMethod" IN ('EMAIL', 'MANUAL'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS work_requests_repair_shop_idx ON work_requests ("repairShopId");

COMMIT;
