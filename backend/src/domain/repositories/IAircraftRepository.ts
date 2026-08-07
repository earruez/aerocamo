import { Aircraft, AircraftStatus, CreateAircraftInput, UpdateAircraftInput } from '../entities/Aircraft';
import { PaginatedResult, PaginationOptions } from './shared';

export type PlanItemStatus = 'OVERDUE' | 'DUE_SOON' | 'OK' | 'NEVER_PERFORMED';
export type DueByType = 'HOURS' | 'CALENDAR';
export type MaintenanceExecutionType = 'maintenance' | 'component_replacement';
export type ApplicationType = 'baseline' | 'application' | 'replacement_start';

export interface MaintenancePlanItem {
  taskId: string;
  taskCode: string;
  taskTitle: string;
  executionType: MaintenanceExecutionType;
  requiresComponentTracking: boolean;
  equipmentScope: 'AIRCRAFT' | 'ENGINE';
  componentDefinitionId: string | null;
  intervalType: string;
  intervalHours: number | null;
  intervalCycles: number | null;
  intervalCalendarDays: number | null;
  intervalCalendarMonths: number | null;
  referenceType: string;
  referenceNumber: string | null;
  isMandatory: boolean;
  estimatedManHours: number | null;
  hasRealCompliance: boolean;
  controlStartAt: Date | null;
  controlStartHours: number | null;
  controlStartCycles: number | null;
  effectiveApplicationType: ApplicationType;
  lastPerformedAt: Date | null;
  lastWorkOrder: string | null;
  lastHoursAtCompliance: number | null;
  nextDueHours: number | null;
  nextDueCycles: number | null;
  nextDueDate: Date | null;
  hoursRemaining: number | null;
  cyclesRemaining: number | null;
  daysRemaining: number | null;
  dueBy: DueByType | null;
  status: PlanItemStatus;
  inWorkRequestNumber: string | null;
  inWorkRequestId: string | null;
  legalSource: 'FABRICANTE' | 'DGAC' | 'EASA';
  lastEvidenceUrl: string | null;
}

export interface IAircraftRepository {
  findById(id: string, organizationId: string): Promise<Aircraft | null>;
  findByRegistration(registration: string, organizationId: string): Promise<Aircraft | null>;
  findAll(
    organizationId: string,
    options?: PaginationOptions,
    statusFilter?: AircraftStatus,
  ): Promise<PaginatedResult<Aircraft>>;
  create(input: CreateAircraftInput): Promise<Aircraft>;
  update(id: string, organizationId: string, input: UpdateAircraftInput): Promise<Aircraft>;
  delete(id: string, organizationId: string): Promise<void>;
  getMaintenancePlan(aircraftId: string, organizationId: string): Promise<MaintenancePlanItem[]>;
}
