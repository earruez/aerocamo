import { apiClient } from './client';

export const reportsApi = {
  /** Informe ejecutivo de flota: disponibilidad, horas y vencimientos por aeronave. */
  async downloadFleetSummaryPdf(): Promise<Blob> {
    const { data } = await apiClient.get('/reports/fleet-summary.pdf', { responseType: 'blob' });
    return data as Blob;
  },

  /** Libro de cumplimientos de una aeronave, para presentar a DGAC o auditoría. */
  async downloadComplianceHistoryPdf(aircraftId: string): Promise<Blob> {
    const { data } = await apiClient.get('/reports/compliance-history.pdf', {
      params: { aircraftId },
      responseType: 'blob',
    });
    return data as Blob;
  },

  /** Vencidas y próximas a vencer de toda la flota, para planificar mantenimiento. */
  async downloadFleetLookaheadPdf(): Promise<Blob> {
    const { data } = await apiClient.get('/reports/fleet-lookahead.pdf', { responseType: 'blob' });
    return data as Blob;
  },
};
