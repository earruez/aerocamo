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

  /** Horas-hombre y costo ESTIMADO (no real) por OT cerrada, valorizado a tarifa fija. */
  async downloadWorkOrderLaborCostPdf(range?: { from?: string; to?: string }): Promise<Blob> {
    const { data } = await apiClient.get('/reports/work-order-labor-cost.pdf', {
      params: range,
      responseType: 'blob',
    });
    return data as Blob;
  },
};
