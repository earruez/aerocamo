-- Manual migration: reference manuals and repair shops (CMA)
-- Date: 2026-08-08
--
-- Dos catálogos que el Access mantenía sueltos y la plataforma no tenía dónde
-- guardar: DOC (el manual vigente por modelo, con su revisión) y CMA (los
-- talleres aeronáuticos que ejecutan trabajo). Ambos se consultan al planificar
-- y al cerrar una OT, así que viven en Configuración y se pueden ampliar.

BEGIN;

CREATE TABLE IF NOT EXISTS maintenance_manuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,

  -- Modelo al que aplica ("RR 300", "ARRIEL 2B1", "BELL 505")
  model varchar(120) NOT NULL,
  -- Documento y su revisión, tal como se cita en la OT
  reference text NOT NULL,
  kind varchar(20) NOT NULL DEFAULT 'ENGINE',
  notes text,

  "createdById" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT maintenance_manuals_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT maintenance_manuals_created_by_fk
    FOREIGN KEY ("createdById") REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT maintenance_manuals_kind_chk
    CHECK (kind IN ('AIRCRAFT', 'ENGINE', 'COMPONENT', 'OTHER'))
);

CREATE INDEX IF NOT EXISTS maintenance_manuals_organization_idx
  ON maintenance_manuals ("organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_manuals_identity_uq
  ON maintenance_manuals ("organizationId", model, md5(reference));

CREATE TABLE IF NOT EXISTS repair_shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,

  -- Código CMA otorgado por la autoridad ("CMA 492"); puede faltar en talleres extranjeros
  code varchar(40),
  name varchar(180) NOT NULL,
  country varchar(80),
  notes text,
  "isActive" boolean NOT NULL DEFAULT true,

  "createdById" uuid,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT repair_shops_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT repair_shops_created_by_fk
    FOREIGN KEY ("createdById") REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS repair_shops_organization_idx
  ON repair_shops ("organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS repair_shops_identity_uq
  ON repair_shops ("organizationId", lower(name));

COMMIT;
