import { apiClient } from './client';

export interface CreateTaskInput {
  code: string;
  ata?: string | null;
  title: string;
  description: string;
  intervalType: string;
  intervalHours?: number | null;
  intervalCycles?: number | null;
  intervalCalendarDays?: number | null;
  intervalCalendarMonths?: number | null;
  toleranceHours?: number | null;
  toleranceCycles?: number | null;
  toleranceCalendarDays?: number | null;
  referenceType: string;
  referenceNumber?: string | null;
  isMandatory: boolean;
  estimatedManHours?: number | null;
  requiresInspection: boolean;
  applicableModel?: string | null;
  applicablePartNumber?: string | null;
}

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'code'>>;

export interface TaskDefinition {
  id: string;
  organizationId: string;
  code: string;
  ata: string | null;
  title: string;
  description: string;
  intervalType: string;
  intervalHours: number | null;
  intervalCycles: number | null;
  intervalCalendarDays: number | null;
  intervalCalendarMonths: number | null;
  toleranceHours: number | null;
  toleranceCycles: number | null;
  toleranceCalendarDays: number | null;
  referenceType: string;
  referenceNumber: string | null;
  isMandatory: boolean;
  estimatedManHours: number | null;
  requiresInspection: boolean;
  applicableModel: string | null;
  applicablePartNumber: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FleetSibling {
  id: string;
  code: string;
  title: string;
  intervalHours: number | null;
  intervalCycles: number | null;
  intervalCalendarDays: number | null;
  intervalCalendarMonths: number | null;
  /** Matrículas que hoy tienen esta tarea activa. */
  aircraft: string[];
}

export const tasksApi = {
  listAll: async (): Promise<TaskDefinition[]> => {
    const { data } = await apiClient.get<{ status: string; data: TaskDefinition[] }>('/tasks');
    return data.data;
  },

  create: async (input: CreateTaskInput): Promise<TaskDefinition> => {
    const { data } = await apiClient.post<{ status: string; data: TaskDefinition }>('/tasks', input);
    return data.data;
  },

  update: async (
    id: string,
    input: UpdateTaskInput & { propagateToTaskIds?: string[] },
  ): Promise<TaskDefinition> => {
    const { data } = await apiClient.patch<{ status: string; data: TaskDefinition }>(`/tasks/${id}`, input);
    return data.data;
  },

  /** Otras tareas de la flota que son la misma normativa (misma AD/SB) en
   *  otras aeronaves — una enmienda debería aplicar a todas. */
  fleetSiblings: async (id: string): Promise<FleetSibling[]> => {
    const { data } = await apiClient.get<{ status: string; data: FleetSibling[] }>(`/tasks/${id}/fleet-siblings`);
    return data.data;
  },

  assignToAircraft: async (aircraftId: string, taskId: string): Promise<void> => {
    await apiClient.post(`/tasks/aircraft/${aircraftId}/assign`, { taskId });
  },

  /** Marca si la tarea aplica o no a la aeronave, conservando el vínculo. */
  setApplicability: async (
    aircraftId: string,
    taskId: string,
    input: { applies: boolean; notes?: string | null },
  ): Promise<void> => {
    await apiClient.patch(`/tasks/aircraft/${aircraftId}/tasks/${taskId}/applicability`, input);
  },

  removeFromAircraft: async (aircraftId: string, taskId: string): Promise<void> => {
    await apiClient.delete(`/tasks/aircraft/${aircraftId}/tasks/${taskId}`);
  },
};
