import { apiClient } from './client';

export type WorkRequestStatus = 'DRAFT' | 'SENT' | 'CANCELLED';
export type WorkRequestItemCategory = 'MAINTENANCE_PLAN' | 'NORMATIVE' | 'COMPONENT_INSPECTION' | 'DISCREPANCY' | 'OTHER';

export interface WorkflowStateMeta {
  visible: 'draft' | 'in_progress' | 'closed' | 'cancelled';
  visibleLabel: string;
  label: string;
  uiTone?: 'neutral' | 'info' | 'warning' | 'success' | 'danger';
  order?: number;
}

export interface WorkflowStateMachine<TStatus extends string> {
  entity: 'work_request' | 'work_order';
  statuses: readonly TStatus[];
  transitions: Record<TStatus, readonly TStatus[]>;
  stateMeta: Record<TStatus, WorkflowStateMeta>;
}

export interface WorkRequestTask {
  id: string;
  taskId: string | null;
  componentId?: string | null;
  discrepancyId?: string | null;
  sourceKind?: 'maintenance_plan' | 'component_inspection' | 'discrepancy' | 'compliance_due' | 'manual';
  sourceId?: string;
  executionType?: 'maintenance_application' | 'component_replacement' | 'discrepancy_action' | null;
  requiresComponentTracking?: boolean;
  componentDefinitionId?: string | null;
  source: string;
  category: WorkRequestItemCategory;
  itemCode: string | null;
  itemTitle: string;
  itemDescription: string | null;
  task?: {
    id: string;
    code: string;
    title: string;
    description: string;
    intervalHours: number | null;
    intervalCycles: number | null;
    intervalCalendarDays: number | null;
  } | null;
}

export interface WorkRequest {
  id: string;
  number: string;
  status: WorkRequestStatus;
  responsibleId: string | null;
  notes: string | null;
  aircraftId: string;
  items: WorkRequestTask[];
  responsible?: { id: string; name: string; email: string } | null;
}

export interface WorkRequestResponsible {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface WorkRequestCatalog {
  maintenancePlan: Array<{ taskId: string; taskCode: string; taskTitle: string; hoursRemaining: number | null; daysRemaining: number | null; status: string }>;
  normative: Array<{ taskId: string; taskCode: string; taskTitle: string; referenceNumber: string | null }>;
  componentInspection: Array<{ taskId: string; taskCode: string; taskTitle: string; referenceNumber: string | null }>;
  components: Array<{ id: string; partNumber: string; serialNumber: string; description: string; position: string | null }>;
  discrepancies: Array<{ id: string; code: string; title: string; description: string; status: string }>;
}

export interface AirworthinessHistoryRow {
  id: string;
  date: string;
  taskCode: string;
  taskTitle: string;
  flightHours: number;
  cycles: number;
  legalBasis: string;
  evidenceUrl: string | null;
  workRequestNumber: string | null;
}

export type WorkRequestSourceKind =
  | 'maintenance_plan'
  | 'component_inspection'
  | 'discrepancy'
  | 'compliance_due'
  | 'manual';

export type WorkRequestExecutionType =
  | 'maintenance_application'
  | 'component_replacement'
  | 'discrepancy_action';

export interface WorkRequestExecutionEligibility {
  eligible: boolean;
  reason: 'ELIGIBLE' | 'NO_VALID_ST_ITEM' | 'NO_SIGNED_WORK_ORDER' | 'INVALID_REQUIRED_COMPONENT';
  message: string;
  workRequestId: string | null;
  workRequestNumber: string | null;
  workOrderNumber: string | null;
  matchedItemId: string | null;
}

export const workRequestsApi = {
  async listByAircraft(aircraftId: string): Promise<WorkRequest[]> {
    const { data } = await apiClient.get<{ status: string; data: WorkRequest[] }>(`/work-requests/aircraft/${aircraftId}`);
    return data.data;
  },

  async createDraft(aircraftId: string, taskIds?: string[]): Promise<WorkRequest> {
    const { data } = await apiClient.post<{ status: string; data: WorkRequest }>('/work-requests', { aircraftId, taskIds });
    return data.data;
  },

  async getById(id: string): Promise<WorkRequest> {
    const { data } = await apiClient.get<{ status: string; data: WorkRequest }>(`/work-requests/${id}`);
    return data.data;
  },

  async updateDraft(id: string, payload: { responsibleId?: string | null; notes?: string | null }) {
    const { data } = await apiClient.patch<{ status: string; data: WorkRequest }>(`/work-requests/${id}`, payload);
    return data.data;
  },

  async addItem(id: string, payload: {
    taskId?: string;
    componentId?: string;
    discrepancyId?: string;
    sourceKind?: WorkRequestSourceKind;
    sourceId?: string;
    executionType?: WorkRequestExecutionType | null;
    requiresComponentTracking?: boolean;
    componentDefinitionId?: string | null;
    category?: WorkRequestItemCategory;
    code?: string | null;
    title?: string;
    description?: string | null;
  }): Promise<WorkRequest> {
    const { data } = await apiClient.post<{ status: string; data: WorkRequest }>(`/work-requests/${id}/items`, payload);
    return data.data;
  },

  async removeItem(id: string, itemId: string): Promise<WorkRequest> {
    const { data } = await apiClient.delete<{ status: string; data: WorkRequest }>(`/work-requests/${id}/items/${itemId}`);
    return data.data;
  },

  async getCatalog(aircraftId: string, search?: string): Promise<WorkRequestCatalog> {
    const { data } = await apiClient.get<{ status: string; data: WorkRequestCatalog }>(
      `/work-requests/aircraft/${aircraftId}/catalog`,
      { params: { search } },
    );
    return data.data;
  },

  async getExecutionEligibility(
    aircraftId: string,
    input: {
      sourceKind: WorkRequestSourceKind;
      sourceId: string;
      executionType: WorkRequestExecutionType;
      requiredComponentSourceId?: string;
    },
  ): Promise<WorkRequestExecutionEligibility> {
    const { data } = await apiClient.get<{ status: string; data: WorkRequestExecutionEligibility }>(
      `/work-requests/aircraft/${aircraftId}/execution-eligibility`,
      { params: input },
    );
    return data.data;
  },

  async listResponsibles(): Promise<WorkRequestResponsible[]> {
    const { data } = await apiClient.get<{ status: string; data: WorkRequestResponsible[] }>('/work-requests/responsibles');
    return data.data;
  },

  getPdfUrl(id: string): string {
    return `/api/v1/work-requests/${id}/pdf`;
  },

  /** Descarga el PDF generado por el servidor (con membrete, tabla y firmas). */
  async downloadPdf(id: string): Promise<Blob> {
    const { data } = await apiClient.get(`/work-requests/${id}/pdf`, { responseType: 'blob' });
    return data as Blob;
  },

  async getStateMachine(): Promise<WorkflowStateMachine<WorkRequestStatus>> {
    const { data } = await apiClient.get<{ status: string; data: WorkflowStateMachine<WorkRequestStatus> }>('/work-requests/state-machine');
    return data.data;
  },

  async send(id: string, dispatch?: {
    repairShopId?: string | null;
    repairShopContactId?: string | null;
    dispatchMethod?: 'EMAIL' | 'MANUAL' | null;
    dispatchNotes?: string | null;
  }): Promise<WorkRequest> {
    const { data } = await apiClient.post<{ status: string; data: WorkRequest }>(
      `/work-requests/${id}/send`,
      dispatch ?? {},
    );
    return data.data;
  },

  /** Anula la ST conservando el registro; exige motivo. */
  async cancel(id: string, reason: string): Promise<WorkRequest> {
    const { data } = await apiClient.post<{ status: string; data: WorkRequest }>(
      `/work-requests/${id}/cancel`,
      { reason },
    );
    return data.data;
  },

  /** Elimina definitivamente. Solo permitido en borrador. */
  async remove(id: string): Promise<void> {
    await apiClient.delete(`/work-requests/${id}`);
  },

  async sendEmail(id: string, email?: string): Promise<void> {
    await apiClient.post(`/work-requests/${id}/send-email`, { email });
  },

  async closeAndComply(
    id: string,
    payload: {
      aircraftHoursAtClose: number;
      aircraftCyclesN1AtClose: number;
      aircraftCyclesN2AtClose: number;
      notes?: string;
      closedAt?: string;
      evidenceFile?: File;
      evidenceUrl?: string;
      evidenceFileName?: string;
    },
  ): Promise<{ generatedCompliances: number }> {
    const form = new FormData();
    form.append('aircraftHoursAtClose', String(payload.aircraftHoursAtClose));
    form.append('aircraftCyclesN1AtClose', String(payload.aircraftCyclesN1AtClose));
    form.append('aircraftCyclesN2AtClose', String(payload.aircraftCyclesN2AtClose));
    if (payload.notes) form.append('notes', payload.notes);
    if (payload.closedAt) form.append('closedAt', payload.closedAt);
    if (payload.evidenceFile) form.append('evidence', payload.evidenceFile);
    if (payload.evidenceUrl) form.append('evidenceUrl', payload.evidenceUrl);
    if (payload.evidenceFileName) form.append('evidenceFileName', payload.evidenceFileName);

    const { data } = await apiClient.post<{ status: string; data: { generatedCompliances: number } }>(
      `/work-requests/${id}/close-and-comply`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return data.data;
  },

  async getAirworthinessHistory(aircraftId: string): Promise<AirworthinessHistoryRow[]> {
    const { data } = await apiClient.get<{ status: string; data: AirworthinessHistoryRow[] }>(
      `/work-requests/aircraft/${aircraftId}/airworthiness-history`,
    );
    return data.data;
  },
};
