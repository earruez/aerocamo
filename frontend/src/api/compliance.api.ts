import { apiClient } from './client';

export interface Compliance {
  id: string;
  aircraftId: string;
  taskId: string;
  componentId: string | null;
  applicationType: 'baseline' | 'application' | 'replacement_start';
  isInitial: boolean;
  performedAt: string;
  aircraftHoursAtCompliance: number;
  aircraftCyclesAtCompliance: number;
  nextDueHours: number | null;
  nextDueCycles: number | null;
  nextDueDate: string | null;
  status: 'COMPLETED' | 'DEFERRED' | 'OVERDUE' | 'CANCELLED';
  workOrderNumber: string | null;
  notes: string | null;
  deferralReference: string | null;
  deferralExpiresAt: string | null;
  task?: {
    code: string;
    title: string;
    description: string;
    referenceType: string | null;
    referenceNumber: string | null;
  } | null;
  component?: {
    id: string;
    partNumber: string;
    serialNumber: string;
  } | null;
  aircraft?: {
    totalFlightHours: number;
    totalCycles: number;
  } | null;
  inspectedBy?: {
    name: string;
  } | null;
}

export interface RecordComplianceInput {
  aircraftId: string;
  taskId: string;
  componentId?: string | null;
  performedAt: string;   // ISO date string
  aircraftHoursAtCompliance?: number;
  nextDueHours?: number | null;
  nextDueCycles?: number | null;
  nextDueDate?: string | null;
  workOrderNumber?: string | null;
  applicationType?: 'application' | 'replacement_start';
  notes?: string | null;
}

export const complianceApi = {
  latestForAircraft: async (aircraftId: string): Promise<Compliance[]> => {
    const { data } = await apiClient.get<{ status: string; data: Compliance[] }>(
      `/compliances/aircraft/${aircraftId}/latest`,
    );
    return data.data;
  },

  historyForTask: async (aircraftId: string, taskId: string): Promise<Compliance[]> => {
    const { data } = await apiClient.get<{ status: string; data: Compliance[] }>(
      `/compliances/aircraft/${aircraftId}/task/${taskId}/history`,
    );
    return data.data ?? [];
  },

  record: async (input: RecordComplianceInput): Promise<Compliance> => {
    const { data } = await apiClient.post<{ status: string; data: Compliance }>('/compliances', input);
    return data.data;
  },
};
