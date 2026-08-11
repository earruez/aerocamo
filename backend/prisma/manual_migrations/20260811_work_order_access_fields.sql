-- Manual migration: shop, manuals and release note on a work order
-- Date: 2026-08-11
--
-- Las 81 órdenes del Access no existían en la plataforma. Al traerlas hacen
-- falta tres datos que la tabla OT guarda y el modelo no tenía: el taller que
-- ejecutó el trabajo, los manuales citados al cerrarla y el certificado de
-- retorno al servicio. Sin ellos la orden queda sin decir quién la hizo ni
-- contra qué revisión, que es justo lo que la vuelve un documento de
-- aeronavegabilidad y no una fecha suelta.

BEGIN;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS "repairShopId" uuid,
  -- El Access los guarda como texto libre: a veces el modelo, a veces la
  -- revisión completa. Se conserva tal cual en vez de forzar un enlace.
  ADD COLUMN IF NOT EXISTS "aircraftManualRef" varchar(255),
  ADD COLUMN IF NOT EXISTS "engineManualRef" varchar(255),
  ADD COLUMN IF NOT EXISTS "releaseToServiceNote" text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_repair_shop_fk') THEN
    ALTER TABLE work_orders ADD CONSTRAINT work_orders_repair_shop_fk
      FOREIGN KEY ("repairShopId") REFERENCES repair_shops(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS work_orders_repair_shop_idx ON work_orders ("repairShopId");

COMMIT;
