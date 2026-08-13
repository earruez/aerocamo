import { apiClient } from './client';
import type { WorkflowStateMachine } from './workRequests.api';

// ── Enums ──────────────────────────────────────────────────────────────────

export type WorkOrderStatus = 'DRAFT' | 'OPEN' | 'IN_PROGRESS' | 'QUALITY' | 'CLOSED';
export type WorkOrderAssignmentStatus = 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'AWAITING_EVIDENCE' | 'EVIDENCE_UPLOADED' | 'CLOSED';
export type WorkOrderEvidenceType = 'PHOTO' | 'PDF' | 'BOTH';
export type DiscrepancyStatus = 'OPEN' | 'DEFERRED' | 'RESOLVED' | 'CANCELLED';

// ── Shapes ─────────────────────────────────────────────────────────────────

export interface WOPersonnel {
  id: string;
  name: string;
  role: string;
  licenseNumber: string | null;
}

export interface WOTask {
  id: string;
  workOrderId: string;
  taskId: string;
  isCompleted: boolean;
  completedAt: string | null;
  completedById: string | null;
  notes: string | null;
  task: {
    id: string;
    code: string;
    title: string;
    description: string;
    intervalType: string;
    intervalHours: number | null;
    intervalCycles: number | null;
    isMandatory: boolean;
    requiresInspection: boolean;
    estimatedManHours: number | null;
    referenceType: string;
    referenceNumber: string | null;
  };
  completedBy: { id: string; name: string } | null;
}

export interface Discrepancy {
  id: string;
  code: string;
  workOrderId: string;
  title: string;
  description: string;
  location: string | null;
  ataChapter: string | null;
  status: DiscrepancyStatus;
  foundById: string;
  foundBy: { id: string; name: string; role: string };
  resolvedBy: { id: string; name: string; role: string } | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  deferralRef: string | null;
  deferralExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkOrder {
  id: string;
  organizationId: string;
  number: string;
  aircraftId: string;
  title: string;
  description: string | null;
  status: WorkOrderStatus;
  // Assignment workflow fields
  assignmentStatus: WorkOrderAssignmentStatus;
  assignedAt: string | null;
  evidenceFileUrl: string | null;
  evidenceFileName: string | null;
  evidenceUploadedAt: string | null;
  evidenceUploadedBy: string | null;
  evidenceType: WorkOrderEvidenceType | null;
  createdById: string;
  assignedTechnicianId: string | null;
  inspectorId: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  aircraftHoursAtOpen: number | null;
  aircraftCyclesAtOpen: number | null;
  aircraftHoursAtClose: number | null;
  aircraftCyclesAtClose: number | null;
  closedById: string | null;
  closedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  aircraft: {
    id: string;
    registration: string;
    model: string;
    totalFlightHours: number;
    totalCycles: number;
  };
  createdBy: WOPersonnel;
  assignedTechnician: WOPersonnel | null;
  inspector: WOPersonnel | null;
  closedBy: WOPersonnel | null;
  tasks: WOTask[];
  discrepancies: Discrepancy[];
  _count?: { discrepancies: number };
}

export interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  userId: string;
  userEmail: string;
  userRole: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface CreateWorkOrderInput {
  aircraftId: string;
  title: string;
  description?: string | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  assignedTechnicianId?: string | null;
  inspectorId?: string | null;
  notes?: string | null;
  taskIds?: string[];
}

export interface CreateDiscrepancyInput {
  title: string;
  description: string;
  location?: string | null;
  ataChapter?: string | null;
}

export interface UpdateDiscrepancyInput {
  title?: string;
  description?: string;
  location?: string | null;
  ataChapter?: string | null;
  status?: DiscrepancyStatus;
  resolutionNotes?: string | null;
  deferralRef?: string | null;
  deferralExpiresAt?: string | null;
}

// ── API client ──────────────────────────────────────────────────────────────

export const workOrdersApi = {
  getStateMachine: async (): Promise<WorkflowStateMachine<WorkOrderStatus>> => {
    const { data } = await apiClient.get<{ status: string; data: WorkflowStateMachine<WorkOrderStatus> }>('/work-orders/state-machine');
    return data.data;
  },

  list: async (params?: { status?: WorkOrderStatus; aircraftId?: string }): Promise<WorkOrder[]> => {
    const q = new URLSearchParams();
    if (params?.status)     q.set('status', params.status);
    if (params?.aircraftId) q.set('aircraftId', params.aircraftId);
    const { data } = await apiClient.get<{ status: string; data: WorkOrder[] }>(
      `/work-orders${q.toString() ? '?' + q.toString() : ''}`,
    );
    return data.data;
  },

  getById: async (id: string): Promise<WorkOrder> => {
    const { data } = await apiClient.get<{ status: string; data: WorkOrder }>(`/work-orders/${id}`);
    return data.data;
  },

  create: async (input: CreateWorkOrderInput): Promise<WorkOrder> => {
    const { data } = await apiClient.post<{ status: string; data: WorkOrder }>('/work-orders', input);
    return data.data;
  },

  update: async (id: string, input: Partial<CreateWorkOrderInput>): Promise<WorkOrder> => {
    const { data } = await apiClient.patch<{ status: string; data: WorkOrder }>(`/work-orders/${id}`, input);
    return data.data;
  },

  transition: async (id: string, status: WorkOrderStatus): Promise<WorkOrder> => {
    const { data } = await apiClient.post<{ status: string; data: WorkOrder }>(`/work-orders/${id}/transition`, { status });
    return data.data;
  },

  addTask: async (id: string, taskId: string): Promise<WOTask> => {
    const { data } = await apiClient.post<{ status: string; data: WOTask }>(`/work-orders/${id}/tasks`, { taskId });
    return data.data;
  },

  removeTask: async (id: string, taskId: string): Promise<void> => {
    await apiClient.delete(`/work-orders/${id}/tasks/${taskId}`);
  },

  completeTask: async (id: string, taskId: string, notes?: string): Promise<WOTask> => {
    const { data } = await apiClient.post<{ status: string; data: WOTask }>(`/work-orders/${id}/tasks/${taskId}/complete`, { notes });
    return data.data;
  },

  // Discrepancies
  listDiscrepancies: async (workOrderId: string): Promise<Discrepancy[]> => {
    const { data } = await apiClient.get<{ status: string; data: Discrepancy[] }>(`/work-orders/${workOrderId}/discrepancies`);
    return data.data;
  },

  createDiscrepancy: async (workOrderId: string, input: CreateDiscrepancyInput): Promise<Discrepancy> => {
    const { data } = await apiClient.post<{ status: string; data: Discrepancy }>(`/work-orders/${workOrderId}/discrepancies`, input);
    return data.data;
  },

  updateDiscrepancy: async (discrepancyId: string, input: UpdateDiscrepancyInput): Promise<Discrepancy> => {
    const { data } = await apiClient.patch<{ status: string; data: Discrepancy }>(`/work-orders/discrepancies/${discrepancyId}`, input);
    return data.data;
  },

  // Audit log
  getAuditLog: async (id: string): Promise<AuditLogEntry[]> => {
    const { data } = await apiClient.get<{ status: string; data: AuditLogEntry[] }>(`/work-orders/${id}/audit-log`);
    return data.data;
  },

  // Document
  getDocument: async (id: string) => {
    const { data } = await apiClient.get<{ status: string; data: unknown }>(`/work-orders/${id}/document`);
    return data.data;
  },

  // ── Assignment Workflow ──────────────────────────────────────────────────

  getPendingAssignment: async (): Promise<WorkOrder[]> => {
    const { data } = await apiClient.get<{ success: boolean; data: WorkOrder[] }>('/work-orders/pending-assignment');
    return data.data;
  },

  assign: async (workOrderId: string, technicianId: string, sendEmail?: boolean): Promise<WorkOrder> => {
    const { data } = await apiClient.post<{ success: boolean; data: WorkOrder }>(`/work-orders/${workOrderId}/assign`, { technicianId, sendEmail });
    return data.data;
  },

  startExecution: async (workOrderId: string): Promise<WorkOrder> => {
    const { data } = await apiClient.post<{ success: boolean; data: WorkOrder }>(`/work-orders/${workOrderId}/start-execution`, {});
    return data.data;
  },

  uploadEvidence: async (workOrderId: string, file: File): Promise<WorkOrder> => {
    const formData = new FormData();
    formData.append('evidence', file);
    const { data } = await apiClient.post<{ success: boolean; data: { workOrder: WorkOrder } }>(
      `/work-orders/${workOrderId}/upload-evidence`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return data.data.workOrder;
  },

  closeWorkOrder: async (workOrderId: string): Promise<WorkOrder> => {
    const { data } = await apiClient.post<{ success: boolean; data: WorkOrder }>(`/work-orders/${workOrderId}/close`, {});
    return data.data;
  },

  downloadPdf: async (workOrderId: string): Promise<Blob> => {
    const { data } = await apiClient.get(`/work-orders/${workOrderId}/download-pdf`, { responseType: 'blob' });
    return data;
  },

  emailPdf: async (workOrderId: string, email: string): Promise<void> => {
    await apiClient.post(`/work-orders/${workOrderId}/email-pdf`, { email });
  },

  generatePendingForAircraft: async (aircraftId: string): Promise<{ generated: boolean; message: string; workOrder?: WorkOrder }> => {
    const { data } = await apiClient.post<{ success: boolean; data: { generated: boolean; message: string; workOrder?: WorkOrder } }>(
      `/work-orders/${aircraftId}/generate-pending`, {}
    );
    return data.data;
  },

  getAvailableTechnicians: async (): Promise<Array<{ id: string; name: string; email: string; licenseNumber: string | null }>> => {
    const { data } = await apiClient.get<{ status: string; data: Array<{ id: string; name: string; email: string; licenseNumber: string | null }> }>(
      '/work-orders/available-technicians'
    );
    return data.data;
  },
};
