DO $$
BEGIN
  CREATE TYPE work_request_item_source_kind AS ENUM (
    'maintenance_plan',
    'component_inspection',
    'discrepancy',
    'compliance_due',
    'manual'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE work_request_item_execution_type AS ENUM (
    'maintenance_application',
    'component_replacement',
    'discrepancy_action'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE work_request_items
  ADD COLUMN IF NOT EXISTS "sourceKind" work_request_item_source_kind NOT NULL DEFAULT 'maintenance_plan',
  ADD COLUMN IF NOT EXISTS "sourceId" varchar(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "executionType" work_request_item_execution_type;

UPDATE work_request_items
SET
  "sourceKind" = CASE
    WHEN "taskId" IS NOT NULL THEN 'maintenance_plan'::work_request_item_source_kind
    WHEN "componentId" IS NOT NULL THEN 'component_inspection'::work_request_item_source_kind
    WHEN "discrepancyId" IS NOT NULL THEN 'discrepancy'::work_request_item_source_kind
    ELSE 'manual'::work_request_item_source_kind
  END,
  "sourceId" = CASE
    WHEN "taskId" IS NOT NULL THEN "taskId"::text
    WHEN "componentId" IS NOT NULL THEN "componentId"::text
    WHEN "discrepancyId" IS NOT NULL THEN "discrepancyId"::text
    ELSE COALESCE(NULLIF("sourceId", ''), CONCAT('manual:', id::text))
  END,
  "executionType" = CASE
    WHEN "taskId" IS NOT NULL THEN COALESCE("executionType", 'maintenance_application'::work_request_item_execution_type)
    ELSE "executionType"
  END
WHERE "sourceId" = '' OR "sourceId" IS NULL OR "executionType" IS NULL OR "sourceKind" IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_request_items_source_kind_source_id
  ON work_request_items ("sourceKind", "sourceId");

CREATE INDEX IF NOT EXISTS idx_work_request_items_execution_type
  ON work_request_items ("executionType");
