import { apiClient } from './client';

export type DueSourceType =
  | 'AD'
  | 'SB'
  | 'INSPECTION'
  | 'MIM'
  | 'DAN'
  | 'COMPONENT'
  | 'ENGINE_COMPONENT'
  | 'MOD';

export type DueMethod = 'H' | 'M' | 'C' | 'N1' | 'N2' | 'LND' | 'RIN';
export type DueStatus = 'OVERDUE' | 'DUE_SOON' | 'OK' | 'NO_CONTEXT' | 'NOT_APPLICABLE' | 'COMPLIED';

export interface DueDimension {
  method: DueMethod;
  intervalValue: number | null;
  intervalUnit: string;
  nextDueValue: number | null;
  nextDueDate: string | null;
  remainingValue: number | null;
  remainingUnit: string;
  status: DueStatus;
}

export interface DueRow {
  id: string;
  aircraftId: string;
  aircraftRegistration: string;
  sourceType: DueSourceType;
  sourceId: string;
  category: string;
  description: string;
  partNumber: string | null;
  serialNumber: string | null;
  method: DueMethod;
  intervalValue: number | null;
  intervalUnit: string;
  lastComplianceValue: number | null;
  lastComplianceDate: string | null;
  nextDueValue: number | null;
  nextDueDate: string | null;
  remainingValue: number | null;
  remainingUnit: string;
  status: DueStatus;
  referenceOt: string | null;
  referenceSt: string | null;
  observations: string | null;
  evidenceReference: string | null;
  isApplicable: boolean;
  complianceType: 'REP' | 'UNA_VEZ' | 'AL_EVENTO';
  sortKey: string;
  sourceDocumentReference: string | null;
  dimensions: DueDimension[];
  activeDimension?: DueMethod | null;
  primaryDueDimension?: DueMethod | null;
}

export interface DueSummary {
  totalRows: number;
  overdueCount: number;
  dueSoonCount: number;
  okCount: number;
  noContextCount: number;
  notApplicableCount: number;
  nearestDueItems: DueRow[];
  groupedByMethod: Record<string, number>;
  groupedBySourceType: Record<string, number>;
}

export interface DueReportData {
  aircraft: {
    id: string;
    registration: string;
    model: string;
    serialNumber: string;
    totalHours: number;
    totalCycles: number;
  };
  summary: DueSummary;
  rows: DueRow[];
}

export const dueApi = {
  async getSummary(aircraftId: string): Promise<DueSummary> {
    const { data } = await apiClient.get<{ status: string; data: DueSummary }>(`/aircraft/${aircraftId}/due-summary`);
    return data.data;
  },

  async getRows(aircraftId: string, filters?: { method?: DueMethod; sourceType?: DueSourceType }): Promise<DueRow[]> {
    const { data } = await apiClient.get<{ status: string; data: DueRow[] }>(`/aircraft/${aircraftId}/due-rows`, {
      params: filters,
    });
    return data.data;
  },

  async getReportData(aircraftId: string): Promise<DueReportData> {
    const { data } = await apiClient.get<{ status: string; data: DueReportData }>(`/aircraft/${aircraftId}/due-report-data`);
    return data.data;
  },
};
