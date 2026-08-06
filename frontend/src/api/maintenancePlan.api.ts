import { apiClient } from './client';

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
  controlStartAt: string | null;
  controlStartHours: number | null;
  controlStartCycles: number | null;
  effectiveApplicationType: ApplicationType;
  lastPerformedAt: string | null;
  lastWorkOrder: string | null;
  lastHoursAtCompliance: number | null;
  nextDueHours: number | null;
  nextDueCycles: number | null;
  nextDueDate: string | null;
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

export const maintenancePlanApi = {
  getForAircraft: async (aircraftId: string): Promise<MaintenancePlanItem[]> => {
    const { data } = await apiClient.get<{ status: string; data: MaintenancePlanItem[] }>(
      `/aircraft/${aircraftId}/maintenance-plan`,
    );
    return data.data;
  },
};
