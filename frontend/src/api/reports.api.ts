import { apiClient } from './client';

export const reportsApi = {
  /** Informe ejecutivo de flota: disponibilidad, horas y vencimientos por aeronave. */
  async downloadFleetSummaryPdf(): Promise<Blob> {
    const { data } = await apiClient.get('/reports/fleet-summary.pdf', { responseType: 'blob' });
    return data as Blob;
  },
};
