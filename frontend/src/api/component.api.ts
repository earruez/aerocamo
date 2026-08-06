import { apiClient } from './client';

export interface Component {
  id: string;
  partNumber: string;
  serialNumber: string;
  description: string;
  position: string | null;
  manufacturer: string | null;
  totalHoursSinceNew: number | null;
  totalCyclesSinceNew: number | null;
  hoursSinceOverhaul: number | null;
  cyclesSinceOverhaul: number | null;
  tboHours: number | null;
  tboCycles: number | null;
  tboCalendarDays: number | null;
  lifeLimitHours: number | null;
  lifeLimitCycles: number | null;
  installationDate: string | null;
  installationAircraftHours: number | null;
  installationAircraftCycles: number | null;
  aircraftId: string | null;
}

export interface CreateComponentInput {
  partNumber: string;
  serialNumber: string;
  description: string;
  manufacturer: string;
  aircraftId?: string | null;
  position?: string | null;
  tboHours?: number | null;
  tboCycles?: number | null;
}

export interface UpdateComponentInstallationInput {
  aircraftId: string;
  installationDate: string;
  position?: string | null;
  notes?: string | null;
}

export interface UpdateComponentInput {
  partNumber?: string;
  serialNumber?: string;
  description?: string;
  manufacturer?: string;
  position?: string | null;
  notes?: string | null;
}

export interface ComponentComplianceRecord {
  id: string;
  applicationType: 'baseline' | 'application' | 'replacement_start';
  isInitial: boolean;
  performedAt: string;
  aircraftHoursAtCompliance: number;
  aircraftCyclesAtCompliance: number;
  nextDueHours: number | null;
  nextDueCycles: number | null;
  nextDueDate: string | null;
  workOrderNumber: string | null;
  notes: string | null;
  status: string;
  task: {
    id: string;
    code: string;
    title: string;
    referenceType: string;
    referenceNumber: string | null;
  };
  performedBy: {
    id: string;
    name: string;
  };
}

export interface RegisterInitialComponentInput {
  aircraftId: string;
  taskId: string;
  partNumber: string;
  serialNumber: string;
  description: string;
  manufacturer: string;
  position?: string | null;
  notes?: string | null;
}

export const componentApi = {
  findByAircraft: (aircraftId: string) =>
    apiClient.get<{ status: string; data: Component[] }>(`/components/aircraft/${aircraftId}`).then((r) => r.data.data),

  findAll: () => apiClient.get<{ status: string; data: Component[] }>('/components').then((r) => r.data.data),

  create: async (input: CreateComponentInput): Promise<Component> => {
    const { data } = await apiClient.post<{ status: string; data: Component }>('/components', input);
    return data.data;
  },

  update: async (componentId: string, input: UpdateComponentInput): Promise<Component> => {
    const { data } = await apiClient.patch<{ status: string; data: Component }>(`/components/${componentId}`, input);
    return data.data;
  },

  updateInstallation: async (componentId: string, input: UpdateComponentInstallationInput): Promise<Component> => {
    const { data } = await apiClient.patch<{ status: string; data: Component }>(`/components/${componentId}/installation`, input);
    return data.data;
  },

  getComplianceHistory: async (componentId: string): Promise<ComponentComplianceRecord[]> => {
    const { data } = await apiClient.get<{ status: string; data: ComponentComplianceRecord[] }>(`/components/${componentId}/compliances`);
    return data.data;
  },

  registerInitialComponent: async (input: RegisterInitialComponentInput): Promise<{ component: Component; compliance: ComponentComplianceRecord }> => {
    const { data } = await apiClient.post<{ status: string; data: { component: Component; compliance: ComponentComplianceRecord } }>(
      '/components/initial-registration',
      input,
    );
    return data.data;
  },
};
