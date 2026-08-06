import { apiClient } from './client';

export type ComponentIntervalType = 'hours' | 'cycles' | 'calendar' | 'mixed';
export type ComponentExecutionType = 'maintenance' | 'component_replacement';
export type ComponentInstanceStatus = 'installed' | 'removed' | 'spare' | 'scrapped';
export type ComponentMovementType = 'install' | 'remove' | 'replacement';
export type ComponentApplicationType = 'baseline' | 'application' | 'replacement_start';

export interface ComponentDefinition {
  id: string;
  organizationId?: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface ComponentInstance {
  id: string;
  organizationId?: string;
  definitionId: string;
  aircraftId: string;
  legacyComponentId?: string | null;
  partNumber: string;
  serialNumber: string;
  position: string;
  status: ComponentInstanceStatus;
  installedAt: string | null;
  removedAt: string | null;
  installedAtHours: number | null;
  removedAtHours: number | null;
  installedAtCycles: number | null;
  removedAtCycles: number | null;
  installWorkOrderNumber: string | null;
  removalWorkOrderNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ComponentApplication {
  id: string;
  organizationId?: string;
  definitionId?: string;
  componentInstanceId: string;
  aircraftId: string;
  taskId: string;
  workRequestId: string;
  officeOrderId: string;
  workOrderNumber: string;
  appliedAt: string;
  aircraftHoursAtApplication: number;
  aircraftCyclesAtApplication: number;
  nextDueHours: number | null;
  nextDueCycles: number | null;
  nextDueDate: string | null;
  applicationType?: ComponentApplicationType;
  // Compatibility with current UI naming while backend field remains applicationType.
  type?: ComponentApplicationType;
  isInitial?: boolean;
  notes: string | null;
  createdAt: string;
}

export interface ComponentMovement {
  id: string;
  organizationId?: string;
  aircraftId: string;
  position: string;
  movementType: ComponentMovementType;
  removedComponentInstanceId: string | null;
  installedComponentInstanceId: string | null;
  workRequestId: string;
  officeOrderId: string;
  workOrderNumber: string;
  performedAt: string;
  aircraftHoursAtMovement: number;
  aircraftCyclesAtMovement: number;
  notes: string | null;
  performedById?: string;
  createdAt: string;
  // Optional convenience labels used by current UI rows.
  removedPartNumber?: string | null;
  removedSerialNumber?: string | null;
  installedPartNumber?: string | null;
  installedSerialNumber?: string | null;
  performedByUserName?: string;
}

export const componentTrackingApi = {
  listDefinitions: async (): Promise<ComponentDefinition[]> => {
    const { data } = await apiClient.get<{ status: string; data: ComponentDefinition[] }>('/components/tracking/definitions');
    return data.data;
  },
  createDefinition: async (input: Omit<ComponentDefinition, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>): Promise<ComponentDefinition> => {
    const { data } = await apiClient.post<{ status: string; data: ComponentDefinition }>('/components/tracking/definitions', input);
    return data.data;
  },

  listInstances: async (aircraftId?: string): Promise<ComponentInstance[]> => {
    const { data } = await apiClient.get<{ status: string; data: ComponentInstance[] }>('/components/tracking/instances', {
      params: aircraftId ? { aircraftId } : undefined,
    });
    return data.data;
  },
  createInstance: async (input: Omit<ComponentInstance, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>): Promise<ComponentInstance> => {
    const { data } = await apiClient.post<{ status: string; data: ComponentInstance }>('/components/tracking/instances', input);
    return data.data;
  },

  listApplications: async (aircraftId?: string): Promise<ComponentApplication[]> => {
    const { data } = await apiClient.get<{ status: string; data: ComponentApplication[] }>('/components/tracking/applications', {
      params: aircraftId ? { aircraftId } : undefined,
    });
    return data.data;
  },
  createApplication: async (input: Omit<ComponentApplication, 'id' | 'organizationId' | 'createdAt'>): Promise<ComponentApplication> => {
    const { data } = await apiClient.post<{ status: string; data: ComponentApplication }>('/components/tracking/applications', input);
    return data.data;
  },

  listMovements: async (aircraftId?: string): Promise<ComponentMovement[]> => {
    const { data } = await apiClient.get<{ status: string; data: ComponentMovement[] }>('/components/tracking/movements', {
      params: aircraftId ? { aircraftId } : undefined,
    });
    return data.data;
  },
  createMovement: async (input: Omit<ComponentMovement, 'id' | 'organizationId' | 'performedById' | 'createdAt'>): Promise<ComponentMovement> => {
    const { data } = await apiClient.post<{ status: string; data: ComponentMovement }>('/components/tracking/movements', input);
    return data.data;
  },
};
