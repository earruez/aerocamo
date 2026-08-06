export type ComponentIntervalType = 'hours' | 'cycles' | 'calendar' | 'mixed';
export type ComponentExecutionType = 'maintenance' | 'component_replacement';
export type ComponentInstanceStatus = 'installed' | 'removed' | 'spare' | 'scrapped';
export type ComponentMovementKind = 'install' | 'remove' | 'replacement';
export type ComponentApplicationType = 'baseline' | 'application' | 'replacement_start';

export interface ComponentDefinition {
  id: string;
  organizationId: string;
  ataChapter: string;
  ataCode: string;
  name: string;
  description: string;
  executionType: ComponentExecutionType;
  intervalType: ComponentIntervalType;
  intervalHours: number | null;
  intervalCycles: number | null;
  intervalDays: number | null;
  requiresComponentTracking: boolean;
  sourceGroup: string;
  reference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ComponentInstance {
  id: string;
  organizationId: string;
  definitionId: string;
  aircraftId: string | null;
  legacyComponentId: string | null;
  partNumber: string;
  serialNumber: string;
  position: string;
  status: ComponentInstanceStatus;
  installedAt: Date | null;
  removedAt: Date | null;
  installedAtHours: number | null;
  removedAtHours: number | null;
  installedAtCycles: number | null;
  removedAtCycles: number | null;
  installWorkOrderNumber: string | null;
  removalWorkOrderNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ComponentApplication {
  id: string;
  organizationId: string;
  definitionId: string;
  componentInstanceId: string | null;
  aircraftId: string;
  taskId: string | null;
  workRequestId: string | null;
  officeOrderId: string | null;
  workOrderNumber: string | null;
  appliedAt: Date;
  aircraftHoursAtApplication: number;
  aircraftCyclesAtApplication: number;
  nextDueHours: number | null;
  nextDueCycles: number | null;
  nextDueDate: Date | null;
  applicationType: ComponentApplicationType;
  isInitial: boolean;
  notes: string | null;
  createdAt: Date;
}

export interface ComponentMovement {
  id: string;
  organizationId: string;
  aircraftId: string;
  position: string;
  movementType: ComponentMovementKind;
  removedComponentInstanceId: string | null;
  installedComponentInstanceId: string | null;
  workRequestId: string | null;
  officeOrderId: string | null;
  workOrderNumber: string | null;
  performedAt: Date;
  aircraftHoursAtMovement: number;
  aircraftCyclesAtMovement: number;
  notes: string | null;
  performedById: string;
  createdAt: Date;
}

export type CreateComponentDefinitionInput = Omit<ComponentDefinition, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>;
export type CreateComponentInstanceInput = Omit<ComponentInstance, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>;
export type CreateComponentApplicationInput = Omit<ComponentApplication, 'id' | 'organizationId' | 'createdAt'>;
export type CreateComponentMovementInput = Omit<ComponentMovement, 'id' | 'organizationId' | 'createdAt'>;
