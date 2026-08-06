// Tipos y enums para Solicitud de Trabajo (ST) y sus items
import type { WorkRequestStatus as ApiWorkRequestStatus } from '../api/workRequests.api';

export type WorkRequestStatus = ApiWorkRequestStatus;

export type WorkRequestExecutionType =
  | 'maintenance_application'
  | 'component_replacement'
  | 'discrepancy_action';

export enum WorkRequestItemStatus {
  PENDING = 'pending',
  SENT = 'sent',
  OBSERVED = 'observed',
  APPROVED = 'approved',
  EXECUTED = 'executed',
  CLOSED = 'closed',
  REJECTED = 'rejected',
}

export type WorkRequestVisibleStatus = 'borrador' | 'en_proceso' | 'cancelada';

export type WorkRequestOrigin =
  | 'maintenance_plan'
  | 'component_inspection'
  | 'discrepancy'
  | 'compliance_due'
  | 'manual';

export interface WorkRequest {
  id: string;
  folio: string;
  aircraftId: string;
  status: WorkRequestStatus;
  priority: 'alta' | 'media' | 'baja';
  createdByUserId: string;
  assignedToOfficeUserId: string | null;
  createdAt: string;
  sentAt?: string;
  reviewedAt?: string;
  closedAt?: string;
  generalNotes?: string;
  pdfUrl?: string;
  emailSentTo?: string;
  otReference?: string;
  returnedSignedOtUrl?: string;
  otReceivedAt?: string;
  otNotes?: string;
  closedByUserId?: string;
  currentOfficeStatus?: WorkRequestStatus;
  updatedAt: string;
  items: WorkRequestItem[];
  attachments: WorkRequestAttachment[];
  statusHistory: WorkRequestStatusHistory[];
}

export interface WorkRequestItem {
  id: string;
  workRequestId: string;
  sourceKind: WorkRequestOrigin;
  sourceId: string;
  ataCode: string;
  referenceCode: string;
  title: string;
  description: string;
  regulatoryBasis: string;
  requiresComponentTracking?: boolean;
  executionType?: WorkRequestExecutionType;
  componentDefinitionId?: string;
  installedComponentInstanceId?: string;
  removedComponentInstanceId?: string;
  priority: 'alta' | 'media' | 'baja';
  observation?: string;
  aircraftHoursAtRequest: number;
  aircraftCyclesAtRequest: number;
  dateAtRequest: string;
  evidenceUrl?: string;
  itemStatus: WorkRequestItemStatus;
  manualEntry?: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkRequestAttachment {
  id: string;
  workRequestId: string;
  workRequestItemId?: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  uploadedByUserId: string;
  uploadedAt: string;
}

export interface WorkRequestStatusHistory {
  id: string;
  workRequestId: string;
  fromStatus: WorkRequestStatus;
  toStatus: WorkRequestStatus;
  changedByUserId: string;
  changedAt: string;
  comment?: string;
}

export interface WorkRequestValidationResult {
  ok: boolean;
  message?: string;
}

export enum STVisibleStatus {
  BORRADOR = 'borrador',
  EN_PROCESO = 'en_proceso',
  CANCELADA = 'cancelada',
}

export const WORK_REQUEST_VISIBLE_STATUS_LABELS: Record<WorkRequestVisibleStatus, string> = {
  borrador: 'Borrador',
  en_proceso: 'En proceso',
  cancelada: 'Cancelada',
};

export const ST_VISIBLE_BADGE_CONFIG: Record<WorkRequestVisibleStatus, { label: string; className: string }> = {
  borrador: {
    label: 'Borrador',
    className: 'bg-slate-200 text-slate-800',
  },
  en_proceso: {
    label: 'En proceso',
    className: 'bg-orange-100 text-orange-800',
  },
  cancelada: {
    label: 'Cancelada',
    className: 'bg-rose-100 text-rose-800',
  },
};

export const WORK_REQUEST_ITEM_STATUS_LABELS: Record<WorkRequestItemStatus, string> = {
  pending: 'Pendiente',
  sent: 'Enviado',
  observed: 'En proceso',
  approved: 'En proceso',
  executed: 'En proceso',
  closed: 'Cerrado',
  rejected: 'En proceso',
};

export interface OfficeOrder {
  id: string;
  workRequestId: string;
  otNumber: string;
  status: 'issued' | 'received' | 'signed' | 'closed';
  issuedAt: string;
  signedAt?: string;
  signedFileUrl?: string;
  createdByOfficeUserId: string;
}

export interface ComplianceRecord {
  id: string;
  aircraftId: string;
  maintenanceTaskId: string;
  workRequestId: string;
  officeOrderId: string;
  complianceDate: string;
  complianceHours: number;
  complianceCycles: number;
  evidenceUrl?: string;
  registeredByUserId: string;
  createdAt: string;
}

export const isActiveWorkRequestStatus = (status: WorkRequestStatus): boolean => (
  status !== 'CANCELLED'
);

export const findActiveWorkRequestByMaintenanceTaskId = (input: {
  workRequests: WorkRequest[];
  aircraftId: string;
  maintenanceTaskId: string;
  excludeWorkRequestId?: string;
}): WorkRequest | null => {
  const taskId = input.maintenanceTaskId.trim();
  if (!taskId) return null;

  const found = input.workRequests.find((wr) => (
    wr.id !== input.excludeWorkRequestId
    && wr.aircraftId === input.aircraftId
    && isActiveWorkRequestStatus(wr.status)
    && wr.items.some((it) => it.sourceId === taskId)
  ));

  return found ?? null;
};

export const findOpenWorkRequestByItem = (input: {
  workRequests: WorkRequest[];
  sourceKind: WorkRequestOrigin;
  sourceId: string;
  excludeWorkRequestId?: string;
}): WorkRequest | null => {
  const normalizedSourceId = input.sourceId.trim();
  if (!normalizedSourceId) return null;

  const found = input.workRequests.find((wr) => (
    wr.id !== input.excludeWorkRequestId
    && isActiveWorkRequestStatus(wr.status)
    && wr.items.some((it) => it.sourceKind === input.sourceKind && it.sourceId === normalizedSourceId)
  ));

  return found ?? null;
};

export const canRegularizeCompliance = (input: {
  status: WorkRequestStatus;
  returnedSignedOtUrl?: string;
  otReference?: string;
}): boolean => false;

export const validateWorkRequestItemRequiredFields = (item: {
  ataCode: string;
  referenceCode: string;
  title: string;
  description: string;
  regulatoryBasis: string;
}): WorkRequestValidationResult => {
  if (!item.title.trim()) return { ok: false, message: 'El item requiere un titulo.' };
  if (!item.ataCode.trim()) return { ok: false, message: 'El item requiere ATA.' };
  if (!item.referenceCode.trim()) return { ok: false, message: 'El item requiere referencia.' };
  if (!item.description.trim()) return { ok: false, message: 'El item requiere descripcion.' };
  if (!item.regulatoryBasis.trim()) return { ok: false, message: 'El item requiere sustento normativo.' };
  return { ok: true };
};
