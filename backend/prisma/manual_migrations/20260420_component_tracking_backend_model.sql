-- Manual migration: real backend component tracking model
-- Date: 2026-04-20

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'component_interval_type') THEN
    CREATE TYPE component_interval_type AS ENUM ('hours', 'cycles', 'calendar', 'mixed');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'component_execution_type') THEN
    CREATE TYPE component_execution_type AS ENUM ('maintenance', 'component_replacement');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'component_instance_status') THEN
    CREATE TYPE component_instance_status AS ENUM ('installed', 'removed', 'spare', 'scrapped');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'component_movement_kind') THEN
    CREATE TYPE component_movement_kind AS ENUM ('install', 'remove', 'replacement');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'compliance_application_type') THEN
    CREATE TYPE compliance_application_type AS ENUM ('baseline', 'application', 'replacement_start');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS component_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "ataChapter" varchar(20) NOT NULL,
  "ataCode" varchar(50) NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "executionType" component_execution_type NOT NULL,
  "intervalType" component_interval_type NOT NULL,
  "intervalHours" numeric(10,2),
  "intervalCycles" integer,
  "intervalDays" integer,
  "requiresComponentTracking" boolean NOT NULL DEFAULT false,
  "sourceGroup" varchar(100) NOT NULL,
  "reference" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT component_definitions_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS component_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "definitionId" uuid NOT NULL,
  "aircraftId" uuid,
  "legacyComponentId" uuid,
  "partNumber" varchar(100) NOT NULL,
  "serialNumber" varchar(100) NOT NULL,
  "position" varchar(150) NOT NULL,
  "status" component_instance_status NOT NULL DEFAULT 'spare',
  "installedAt" timestamptz,
  "removedAt" timestamptz,
  "installedAtHours" numeric(10,2),
  "removedAtHours" numeric(10,2),
  "installedAtCycles" integer,
  "removedAtCycles" integer,
  "installWorkOrderNumber" varchar(50),
  "removalWorkOrderNumber" varchar(50),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT component_instances_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id)
    ON DELETE CASCADE,
  CONSTRAINT component_instances_definition_fk
    FOREIGN KEY ("definitionId") REFERENCES component_definitions(id)
    ON DELETE RESTRICT,
  CONSTRAINT component_instances_aircraft_fk
    FOREIGN KEY ("aircraftId") REFERENCES aircraft(id)
    ON DELETE SET NULL,
  CONSTRAINT component_instances_legacy_component_fk
    FOREIGN KEY ("legacyComponentId") REFERENCES components(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS component_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "definitionId" uuid NOT NULL,
  "componentInstanceId" uuid,
  "aircraftId" uuid NOT NULL,
  "taskId" uuid,
  "workRequestId" uuid,
  "officeOrderId" varchar(100),
  "workOrderNumber" varchar(50),
  "appliedAt" timestamptz NOT NULL,
  "aircraftHoursAtApplication" numeric(10,2) NOT NULL,
  "aircraftCyclesAtApplication" integer NOT NULL,
  "nextDueHours" numeric(10,2),
  "nextDueCycles" integer,
  "nextDueDate" date,
  "applicationType" compliance_application_type NOT NULL DEFAULT 'application',
  "isInitial" boolean NOT NULL DEFAULT false,
  "notes" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT component_applications_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id)
    ON DELETE CASCADE,
  CONSTRAINT component_applications_definition_fk
    FOREIGN KEY ("definitionId") REFERENCES component_definitions(id)
    ON DELETE RESTRICT,
  CONSTRAINT component_applications_instance_fk
    FOREIGN KEY ("componentInstanceId") REFERENCES component_instances(id)
    ON DELETE SET NULL,
  CONSTRAINT component_applications_aircraft_fk
    FOREIGN KEY ("aircraftId") REFERENCES aircraft(id)
    ON DELETE CASCADE,
  CONSTRAINT component_applications_task_fk
    FOREIGN KEY ("taskId") REFERENCES maintenance_tasks(id)
    ON DELETE SET NULL,
  CONSTRAINT component_applications_work_request_fk
    FOREIGN KEY ("workRequestId") REFERENCES work_requests(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS component_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "aircraftId" uuid NOT NULL,
  "position" varchar(150) NOT NULL,
  "movementType" component_movement_kind NOT NULL,
  "removedComponentInstanceId" uuid,
  "installedComponentInstanceId" uuid,
  "workRequestId" uuid,
  "officeOrderId" varchar(100),
  "workOrderNumber" varchar(50),
  "performedAt" timestamptz NOT NULL,
  "aircraftHoursAtMovement" numeric(10,2) NOT NULL,
  "aircraftCyclesAtMovement" integer NOT NULL,
  "notes" text,
  "performedById" uuid NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT component_movements_organization_fk
    FOREIGN KEY ("organizationId") REFERENCES organizations(id)
    ON DELETE CASCADE,
  CONSTRAINT component_movements_aircraft_fk
    FOREIGN KEY ("aircraftId") REFERENCES aircraft(id)
    ON DELETE CASCADE,
  CONSTRAINT component_movements_removed_instance_fk
    FOREIGN KEY ("removedComponentInstanceId") REFERENCES component_instances(id)
    ON DELETE SET NULL,
  CONSTRAINT component_movements_installed_instance_fk
    FOREIGN KEY ("installedComponentInstanceId") REFERENCES component_instances(id)
    ON DELETE SET NULL,
  CONSTRAINT component_movements_work_request_fk
    FOREIGN KEY ("workRequestId") REFERENCES work_requests(id)
    ON DELETE SET NULL,
  CONSTRAINT component_movements_performed_by_fk
    FOREIGN KEY ("performedById") REFERENCES users(id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS component_instances_serial_org_uidx
  ON component_instances ("serialNumber", "organizationId");

CREATE INDEX IF NOT EXISTS component_definitions_org_idx
  ON component_definitions ("organizationId");

CREATE INDEX IF NOT EXISTS component_definitions_org_ata_code_idx
  ON component_definitions ("organizationId", "ataCode");

CREATE INDEX IF NOT EXISTS component_instances_org_idx
  ON component_instances ("organizationId");

CREATE INDEX IF NOT EXISTS component_instances_aircraft_idx
  ON component_instances ("aircraftId");

CREATE INDEX IF NOT EXISTS component_instances_definition_idx
  ON component_instances ("definitionId");

CREATE INDEX IF NOT EXISTS component_instances_legacy_component_idx
  ON component_instances ("legacyComponentId");

CREATE INDEX IF NOT EXISTS component_applications_org_idx
  ON component_applications ("organizationId");

CREATE INDEX IF NOT EXISTS component_applications_aircraft_idx
  ON component_applications ("aircraftId");

CREATE INDEX IF NOT EXISTS component_applications_definition_idx
  ON component_applications ("definitionId");

CREATE INDEX IF NOT EXISTS component_applications_instance_idx
  ON component_applications ("componentInstanceId");

CREATE INDEX IF NOT EXISTS component_applications_work_request_idx
  ON component_applications ("workRequestId");

CREATE INDEX IF NOT EXISTS component_movements_org_idx
  ON component_movements ("organizationId");

CREATE INDEX IF NOT EXISTS component_movements_aircraft_idx
  ON component_movements ("aircraftId");

CREATE INDEX IF NOT EXISTS component_movements_work_request_idx
  ON component_movements ("workRequestId");

CREATE INDEX IF NOT EXISTS component_movements_removed_instance_idx
  ON component_movements ("removedComponentInstanceId");

CREATE INDEX IF NOT EXISTS component_movements_installed_instance_idx
  ON component_movements ("installedComponentInstanceId");

COMMIT;
