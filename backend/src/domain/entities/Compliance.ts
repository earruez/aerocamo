export type ComplianceStatus = 'COMPLETED' | 'DEFERRED' | 'OVERDUE' | 'CANCELLED';
export type ComplianceApplicationType = 'baseline' | 'application' | 'replacement_start';

export interface Compliance {
  id: string;
  organizationId: string;
  aircraftId: string;
  taskId: string;
  componentId: string | null;
  performedById: string;
  inspectedById: string | null;
  performedAt: Date;
  aircraftHoursAtCompliance: number;
  aircraftCyclesAtCompliance: number;
  nextDueHours: number | null;
  nextDueCycles: number | null;
  nextDueDate: Date | null;
  workOrderNumber: string | null;
  applicationType: ComplianceApplicationType;
  isInitial: boolean;
  status: ComplianceStatus;
  deferralReference: string | null;
  deferralExpiresAt: Date | null;
  notes: string | null;
  createdAt: Date;
  /** Hydrated by repositories that join the task (not present on bare `create()` results). */
  task?: { code: string; title: string; description: string; referenceType: string | null; referenceNumber: string | null } | null;
  component?: { id: string; partNumber: string; serialNumber: string } | null;
  inspectedBy?: { id: string; name: string } | null;
}

export type CreateComplianceInput = Pick<
  Compliance,
  | 'organizationId'
  | 'aircraftId'
  | 'taskId'
  | 'componentId'
  | 'performedById'
  | 'inspectedById'
  | 'performedAt'
  | 'aircraftHoursAtCompliance'
  | 'aircraftCyclesAtCompliance'
  | 'nextDueHours'
  | 'nextDueCycles'
  | 'nextDueDate'
  | 'workOrderNumber'
  | 'applicationType'
  | 'isInitial'
  | 'notes'
  | 'deferralReference'
  | 'deferralExpiresAt'
>;
