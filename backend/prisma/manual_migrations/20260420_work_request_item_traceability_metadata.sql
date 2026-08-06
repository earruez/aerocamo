ALTER TABLE work_request_items
  ADD COLUMN IF NOT EXISTS "requiresComponentTracking" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "componentDefinitionId" uuid;

UPDATE work_request_items
SET
  "requiresComponentTracking" = CASE
    WHEN "componentId" IS NOT NULL THEN true
    WHEN "executionType" = 'component_replacement'::work_request_item_execution_type THEN true
    ELSE "requiresComponentTracking"
  END,
  "componentDefinitionId" = CASE
    WHEN "componentDefinitionId" IS NOT NULL THEN "componentDefinitionId"
    WHEN "taskId" IS NOT NULL THEN "taskId"
    ELSE NULL
  END
WHERE "componentDefinitionId" IS NULL OR "requiresComponentTracking" = false;

CREATE INDEX IF NOT EXISTS idx_work_request_items_component_definition_id
  ON work_request_items ("componentDefinitionId");
