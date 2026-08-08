import { UserRole, WorkOrderStatus, WorkRequestStatus } from '@prisma/client';
import { ForbiddenError, ValidationError } from '../../shared/errors/AppError';

export interface WorkflowStateMeta {
  visible: 'draft' | 'in_progress' | 'closed' | 'cancelled';
  visibleLabel: string;
  label: string;
  uiTone?: 'neutral' | 'info' | 'warning' | 'success' | 'danger';
  order?: number;
}

export interface WorkflowStateMachine<TStatus extends string> {
  entity: 'work_request' | 'work_order';
  statuses: TStatus[];
  transitions: Record<TStatus, TStatus[]>;
  stateMeta: Record<TStatus, WorkflowStateMeta>;
}

export const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, Partial<Record<WorkOrderStatus, UserRole[]>>> = {
  DRAFT: {
    OPEN: ['ADMIN', 'SUPERVISOR'],
  },
  OPEN: {
    IN_PROGRESS: ['ADMIN', 'SUPERVISOR', 'TECHNICIAN'],
    DRAFT: ['ADMIN', 'SUPERVISOR'],
  },
  IN_PROGRESS: {
    QUALITY: ['ADMIN', 'SUPERVISOR', 'TECHNICIAN'],
    OPEN: ['ADMIN', 'SUPERVISOR'],
  },
  QUALITY: {
    CLOSED: ['ADMIN', 'INSPECTOR'],
    IN_PROGRESS: ['ADMIN', 'SUPERVISOR', 'INSPECTOR'],
  },
  CLOSED: {},
};

export const WORK_ORDER_STATE_MACHINE: WorkflowStateMachine<WorkOrderStatus> = {
  entity: 'work_order',
  statuses: ['DRAFT', 'OPEN', 'IN_PROGRESS', 'QUALITY', 'CLOSED'],
  transitions: {
    DRAFT: ['OPEN'],
    OPEN: ['IN_PROGRESS', 'DRAFT'],
    IN_PROGRESS: ['QUALITY', 'OPEN'],
    QUALITY: ['CLOSED', 'IN_PROGRESS'],
    CLOSED: [],
  },
  stateMeta: {
    DRAFT: { visible: 'draft', visibleLabel: 'Borrador', label: 'Borrador', uiTone: 'neutral', order: 0 },
    OPEN: { visible: 'in_progress', visibleLabel: 'En proceso', label: 'Abierta', uiTone: 'info', order: 1 },
    IN_PROGRESS: { visible: 'in_progress', visibleLabel: 'En proceso', label: 'En ejecución', uiTone: 'warning', order: 2 },
    QUALITY: { visible: 'in_progress', visibleLabel: 'En proceso', label: 'Calidad', uiTone: 'warning', order: 3 },
    CLOSED: { visible: 'closed', visibleLabel: 'Cerrada', label: 'Cerrada', uiTone: 'success', order: 4 },
  },
};

export const WORK_REQUEST_STATE_MACHINE: WorkflowStateMachine<WorkRequestStatus> = {
  entity: 'work_request',
  statuses: ['DRAFT', 'IN_REVIEW', 'SENT', 'OT_RECEIVED', 'CLOSED', 'CANCELLED'],
  transitions: {
    DRAFT: ['IN_REVIEW', 'SENT', 'CANCELLED'],
    // La revisión puede devolver la ST a borrador si hay algo que corregir.
    IN_REVIEW: ['DRAFT', 'SENT', 'CANCELLED'],
    SENT: ['OT_RECEIVED', 'CANCELLED'],
    // Cerrar exige haber recibido la OT: es el respaldo del cumplimiento.
    OT_RECEIVED: ['CLOSED', 'CANCELLED'],
    CLOSED: [],
    CANCELLED: [],
  },
  stateMeta: {
    DRAFT: { visible: 'draft', visibleLabel: 'Borrador', label: 'Borrador', uiTone: 'neutral', order: 0 },
    IN_REVIEW: { visible: 'in_progress', visibleLabel: 'En revisión', label: 'En revisión', uiTone: 'warning', order: 1 },
    SENT: { visible: 'in_progress', visibleLabel: 'Enviada', label: 'Enviada al taller', uiTone: 'info', order: 2 },
    OT_RECEIVED: { visible: 'in_progress', visibleLabel: 'OT recibida', label: 'OT recibida', uiTone: 'info', order: 3 },
    CLOSED: { visible: 'closed', visibleLabel: 'Cerrada', label: 'Cerrada', uiTone: 'success', order: 4 },
    CANCELLED: { visible: 'cancelled', visibleLabel: 'Cancelada', label: 'Cancelada', uiTone: 'danger', order: 5 },
  },
};

export function isTransitionAllowed<TStatus extends string>(
  machine: WorkflowStateMachine<TStatus>,
  currentStatus: TStatus,
  nextStatus: TStatus,
): boolean {
  return machine.transitions[currentStatus]?.includes(nextStatus) ?? false;
}

export function assertValidTransition<TStatus extends string>(
  machine: WorkflowStateMachine<TStatus>,
  currentStatus: TStatus,
  nextStatus: TStatus,
  entityLabel: string,
): void {
  if (!isTransitionAllowed(machine, currentStatus, nextStatus)) {
    const allowed = machine.transitions[currentStatus] ?? [];
    const allowedText = allowed.length ? allowed.join(', ') : 'none';
    throw new ValidationError(
      `Invalid ${entityLabel} transition: ${currentStatus} -> ${nextStatus}. Allowed: ${allowedText}`,
    );
  }
}

export function assertWorkOrderTransitionRole(
  currentStatus: WorkOrderStatus,
  nextStatus: WorkOrderStatus,
  role: UserRole,
): void {
  const allowedRoles = WORK_ORDER_TRANSITIONS[currentStatus]?.[nextStatus];
  if (!allowedRoles) {
    throw new ValidationError(`Invalid Work Order transition: ${currentStatus} -> ${nextStatus}`);
  }
  if (!allowedRoles.includes(role)) {
    throw new ForbiddenError(
      `Role '${role}' cannot move a Work Order from ${currentStatus} to ${nextStatus}`,
    );
  }
}
