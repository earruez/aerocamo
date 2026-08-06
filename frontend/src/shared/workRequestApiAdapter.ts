import {
  WorkRequest as ApiWorkRequest,
  WorkRequestStatus as ApiWorkRequestStatus,
  WorkRequestTask,
} from '../api/workRequests.api';
import {
  WorkRequest,
  WorkRequestItem,
  WorkRequestItemStatus,
  WorkRequestOrigin,
} from './workRequestTypes';

type ApiWorkRequestLike = ApiWorkRequest & Partial<{
  createdAt: string;
  updatedAt: string;
  sentAt: string;
  closedAt: string;
}>;

function mapStatus(status: ApiWorkRequestStatus): ApiWorkRequestStatus {
  return status;
}

function mapSourceKind(task: WorkRequestTask): WorkRequestOrigin {
  if (task.category === 'MAINTENANCE_PLAN') return 'maintenance_plan';
  if (task.category === 'COMPONENT_INSPECTION') return 'component_inspection';
  if (task.category === 'DISCREPANCY') return 'discrepancy';
  if (task.category === 'NORMATIVE') return 'compliance_due';
  return 'manual';
}

function mapItemStatus(workRequestStatus: ApiWorkRequestStatus): WorkRequestItemStatus {
  if (workRequestStatus === 'DRAFT') return WorkRequestItemStatus.PENDING;
  if (workRequestStatus === 'SENT') return WorkRequestItemStatus.SENT;
  return WorkRequestItemStatus.CLOSED;
}

function mapTaskToItem(task: WorkRequestTask, wr: ApiWorkRequestLike): WorkRequestItem {
  const nowIso = new Date().toISOString();
  const baseDate = wr.createdAt ?? nowIso;

  return {
    id: task.id,
    workRequestId: wr.id,
    sourceKind: task.sourceKind ?? mapSourceKind(task),
    sourceId: task.sourceId ?? task.taskId ?? task.componentId ?? task.discrepancyId ?? task.id,
    ataCode: task.itemCode ?? task.task?.code ?? 'N/A',
    referenceCode: task.itemCode ?? task.task?.code ?? 'N/A',
    title: task.itemTitle,
    description: task.itemDescription ?? task.itemTitle,
    regulatoryBasis: task.source || 'Backend',
    priority: 'media',
    aircraftHoursAtRequest: 0,
    aircraftCyclesAtRequest: 0,
    dateAtRequest: baseDate.slice(0, 10),
    requiresComponentTracking: task.requiresComponentTracking ?? false,
    executionType: task.executionType ?? undefined,
    componentDefinitionId: task.componentDefinitionId ?? undefined,
    itemStatus: mapItemStatus(wr.status),
    createdAt: baseDate,
    updatedAt: wr.updatedAt ?? baseDate,
  };
}

export function adaptApiWorkRequest(wr: ApiWorkRequest): WorkRequest {
  const typed = wr as ApiWorkRequestLike;
  const nowIso = new Date().toISOString();
  const createdAt = typed.createdAt ?? nowIso;
  const updatedAt = typed.updatedAt ?? createdAt;

  return {
    id: wr.id,
    folio: wr.number,
    aircraftId: wr.aircraftId,
    status: mapStatus(wr.status),
    priority: 'media',
    createdByUserId: wr.responsibleId ?? 'system',
    assignedToOfficeUserId: wr.responsibleId,
    createdAt,
    sentAt: typed.sentAt,
    closedAt: typed.closedAt,
    generalNotes: wr.notes ?? '',
    updatedAt,
    items: wr.items.map((item) => mapTaskToItem(item, typed)),
    attachments: [],
    statusHistory: [],
  };
}

export function upsertWorkRequestCache(current: WorkRequest[], next: WorkRequest): WorkRequest[] {
  const withoutCurrent = current.filter((wr) => wr.id !== next.id);
  return [next, ...withoutCurrent];
}
