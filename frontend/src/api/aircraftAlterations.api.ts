import { apiClient } from './client';

/** Alteración aprobada a la configuración de la aeronave (STC / Formulario DGAC 337). */
export interface AircraftAlteration {
  id: string;
  aircraftId: string;
  documentNumber: string;
  description: string;
  approvalDate: string | null;
  hasFlightManualSupplement: boolean;
  flightManualReference: string | null;
  hasIca: boolean;
  icaReference: string | null;
  reference: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

export interface AircraftAlterationInput {
  documentNumber: string;
  description: string;
  approvalDate?: string | null;
  hasFlightManualSupplement?: boolean;
  flightManualReference?: string | null;
  hasIca?: boolean;
  icaReference?: string | null;
  reference?: string | null;
  notes?: string | null;
}

export const aircraftAlterationsApi = {
  listByAircraft: async (aircraftId: string): Promise<AircraftAlteration[]> => {
    const { data } = await apiClient.get<{ status: string; data: AircraftAlteration[] }>(
      `/aircraft/${aircraftId}/alterations`,
    );
    return data.data;
  },

  create: async (aircraftId: string, input: AircraftAlterationInput): Promise<AircraftAlteration> => {
    const { data } = await apiClient.post<{ status: string; data: AircraftAlteration }>(
      `/aircraft/${aircraftId}/alterations`,
      input,
    );
    return data.data;
  },

  update: async (id: string, input: Partial<AircraftAlterationInput>): Promise<AircraftAlteration> => {
    const { data } = await apiClient.patch<{ status: string; data: AircraftAlteration }>(
      `/alterations/${id}`,
      input,
    );
    return data.data;
  },

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/alterations/${id}`);
  },
};
