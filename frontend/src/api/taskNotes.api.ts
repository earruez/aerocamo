import { apiClient } from './client';

/** Nota de revisión sobre una tarea, sin cumplimiento asociado. */
export interface AircraftTaskNote {
  id: string;
  aircraftId: string;
  taskId: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string; role: string } | null;
}

export const taskNotesApi = {
  listForTask: async (aircraftId: string, taskId: string): Promise<AircraftTaskNote[]> => {
    const { data } = await apiClient.get<{ status: string; data: AircraftTaskNote[] }>(
      `/aircraft/${aircraftId}/task/${taskId}/notes`,
    );
    return data.data;
  },

  /** Conteo por tarea, para marcar en el plan cuáles tienen notas. */
  countsByAircraft: async (aircraftId: string): Promise<Record<string, number>> => {
    const { data } = await apiClient.get<{ status: string; data: Array<{ taskId: string; count: number }> }>(
      `/aircraft/${aircraftId}/task-notes`,
    );
    return Object.fromEntries(data.data.map((row) => [row.taskId, row.count]));
  },

  create: async (aircraftId: string, taskId: string, note: string): Promise<AircraftTaskNote> => {
    const { data } = await apiClient.post<{ status: string; data: AircraftTaskNote }>(
      `/aircraft/${aircraftId}/task/${taskId}/notes`,
      { note },
    );
    return data.data;
  },

  update: async (id: string, note: string): Promise<AircraftTaskNote> => {
    const { data } = await apiClient.patch<{ status: string; data: AircraftTaskNote }>(
      `/task-notes/${id}`,
      { note },
    );
    return data.data;
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/task-notes/${id}`);
  },
};
