// ─────────────────────────────────────────────────────────────────────────────
//  WorkOrderService  —  State machine + business rules for Órdenes de Trabajo
// ─────────────────────────────────────────────────────────────────────────────

import { WorkOrderStatus, UserRole } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.client';
import { auditLogService } from './AuditLogService';
import {
  WORK_ORDER_STATE_MACHINE,
  assertValidTransition,
  assertWorkOrderTransitionRole,
} from '../workflows/stateMachines';
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
} from '../../shared/errors/AppError';

// ── Create input ──────────────────────────────────────────────────────────────

export interface CreateWorkOrderInput {
  aircraftId: string;
  title: string;
  description?: string | null;
  plannedStartDate?: Date | null;
  plannedEndDate?: Date | null;
  assignedTechnicianId?: string | null;
  inspectorId?: string | null;
  notes?: string | null;
  taskIds?: string[];   // pre-assign tasks to this WO
}

// ── Update input ──────────────────────────────────────────────────────────────

export interface UpdateWorkOrderInput {
  title?: string;
  description?: string | null;
  plannedStartDate?: Date | null;
  plannedEndDate?: Date | null;
  assignedTechnicianId?: string | null;
  inspectorId?: string | null;
  notes?: string | null;
  aircraftHoursAtOpen?: number | null;
  aircraftCyclesAtOpen?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────

export class WorkOrderService {

  // ── Generate sequential WO number ─────────────────────────────────────────
  private async generateNumber(organizationId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await prisma.workOrder.count({
      where: { organizationId, number: { startsWith: `OT-${year}-` } },
    });
    return `OT-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  // ── Create ─────────────────────────────────────────────────────────────────
  async create(
    input: CreateWorkOrderInput,
    organizationId: string,
    currentUser: { id: string; email: string; role: UserRole },
  ) {
    // Validate aircraft belongs to org
    const aircraft = await prisma.aircraft.findFirst({
      where: { id: input.aircraftId, organizationId },
    });
    if (!aircraft) throw new NotFoundError('Aircraft', input.aircraftId);

    // Validate assigned technician belongs to org (if provided)
    if (input.assignedTechnicianId) {
      const tech = await prisma.user.findFirst({
        where: { id: input.assignedTechnicianId, organizationId, isActive: true },
      });
      if (!tech) throw new NotFoundError('Technician', input.assignedTechnicianId);
    }

    // Validate inspector belongs to org and has INSPECTOR role (if provided)
    if (input.inspectorId) {
      const inspector = await prisma.user.findFirst({
        where: { id: input.inspectorId, organizationId, isActive: true, role: 'INSPECTOR' },
      });
      if (!inspector) throw new ValidationError('The designated inspector must have the INSPECTOR role');
    }

    const number = await this.generateNumber(organizationId);

    const workOrder = await prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.create({
        data: {
          organizationId,
          number,
          aircraftId:            input.aircraftId,
          title:                 input.title,
          description:           input.description ?? null,
          plannedStartDate:      input.plannedStartDate ?? null,
          plannedEndDate:        input.plannedEndDate ?? null,
          assignedTechnicianId:  input.assignedTechnicianId ?? null,
          inspectorId:           input.inspectorId ?? null,
          createdById:           currentUser.id,
          notes:                 input.notes ?? null,
          status:                'DRAFT',
        },
        include: this.fullInclude,
      });

      // Pre-assign tasks if provided
      if (input.taskIds && input.taskIds.length > 0) {
        await tx.workOrderTask.createMany({
          data: input.taskIds.map(taskId => ({ workOrderId: wo.id, taskId })),
          skipDuplicates: true,
        });
      }

      return wo;
    });

    await auditLogService.log({
      organizationId,
      entityType:   'WorkOrder',
      entityId:     workOrder.id,
      action:       'CREATED',
      newValue:     { number: workOrder.number, status: 'DRAFT', aircraftId: workOrder.aircraftId },
      userId:       currentUser.id,
      userEmail:    currentUser.email,
      userRole:     currentUser.role,
      workOrderId:  workOrder.id,
    });

    return workOrder;
  }

  // ── Update metadata (only when DRAFT or OPEN) ─────────────────────────────
  async update(
    id: string,
    input: UpdateWorkOrderInput,
    organizationId: string,
    currentUser: { id: string; email: string; role: UserRole },
  ) {
    const wo = await this.findOrFail(id, organizationId);

    if (['QUALITY', 'CLOSED'].includes(wo.status)) {
      throw new ValidationError('Una OT en revisión de Calidad o Cerrada no puede modificarse');
    }

    if (input.inspectorId) {
      const inspector = await prisma.user.findFirst({
        where: { id: input.inspectorId, organizationId, isActive: true, role: 'INSPECTOR' },
      });
      if (!inspector) throw new ValidationError('The designated inspector must have the INSPECTOR role');
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data:  input,
      include: this.fullInclude,
    });

    await auditLogService.log({
      organizationId,
      entityType:   'WorkOrder',
      entityId:     id,
      action:       'UPDATED',
      previousValue: { title: wo.title, status: wo.status },
      newValue:      { title: updated.title, status: updated.status },
      userId:        currentUser.id,
      userEmail:     currentUser.email,
      userRole:      currentUser.role,
      workOrderId:   id,
    });

    return updated;
  }

  // ── Transition state ───────────────────────────────────────────────────────
  async transition(
    id: string,
    newStatus: WorkOrderStatus,
    organizationId: string,
    currentUser: { id: string; email: string; role: UserRole },
  ) {
    const wo = await this.findOrFail(id, organizationId);

    assertValidTransition(WORK_ORDER_STATE_MACHINE, wo.status, newStatus, 'Work Order');
    assertWorkOrderTransitionRole(wo.status, newStatus, currentUser.role);

    // Business rules per source→target transition
    if (wo.status === 'DRAFT' && newStatus === 'OPEN') {
      const taskCount = await prisma.workOrderTask.count({ where: { workOrderId: wo.id } });
      if (taskCount === 0) {
        throw new ValidationError('No se puede emitir la OT: debe tener al menos una tarea asignada antes de abrirla');
      }
    }

    if (wo.status === 'IN_PROGRESS' && newStatus === 'QUALITY') {
      const pending = await prisma.workOrderTask.count({ where: { workOrderId: wo.id, isCompleted: false } });
      if (pending > 0) {
        throw new ValidationError(`No se puede enviar a Calidad: quedan ${pending} tarea(s) sin completar`);
      }
    }

    if (newStatus === 'CLOSED') {
      await this.assertReadyToClose(wo.id);

      if (!['ADMIN', 'INSPECTOR'].includes(currentUser.role)) {
        throw new ForbiddenError('Only an Inspector or Admin can close a Work Order');
      }
    }

    // Compute extra fields for the transition
    const extraData: Record<string, unknown> = {
      status: newStatus,
      updatedAt: new Date(),
    };

    if (newStatus === 'IN_PROGRESS' && !wo.actualStartDate) {
      extraData.actualStartDate = new Date();
    }
    if (newStatus === 'CLOSED') {
      extraData.closedById = currentUser.id;
      extraData.closedAt   = new Date();
      extraData.actualEndDate = new Date();

      // Snapshot aircraft hours/cycles at close
      const aircraft = await prisma.aircraft.findUnique({ where: { id: wo.aircraftId } });
      if (aircraft) {
        extraData.aircraftHoursAtClose  = aircraft.totalFlightHours;
        extraData.aircraftCyclesAtClose = aircraft.totalCycles;
      }
    }
    if (newStatus === 'OPEN' && wo.status === 'DRAFT') {
      // Snapshot aircraft state at open
      const aircraft = await prisma.aircraft.findUnique({ where: { id: wo.aircraftId } });
      if (aircraft) {
        extraData.aircraftHoursAtOpen  = aircraft.totalFlightHours;
        extraData.aircraftCyclesAtOpen = aircraft.totalCycles;
      }
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data:  extraData,
      include: this.fullInclude,
    });

    await auditLogService.log({
      organizationId,
      entityType:    'WorkOrder',
      entityId:      id,
      action:        'STATUS_CHANGED',
      previousValue: { status: wo.status },
      newValue:      { status: newStatus },
      userId:        currentUser.id,
      userEmail:     currentUser.email,
      userRole:      currentUser.role,
      workOrderId:   id,
      metadata:      { transition: `${wo.status} → ${newStatus}` },
    });

    return updated;
  }

  // ── Add / remove tasks ─────────────────────────────────────────────────────
  async addTask(workOrderId: string, taskId: string, organizationId: string) {
    const wo = await this.findOrFail(workOrderId, organizationId);
    if (wo.status === 'CLOSED') throw new ValidationError('Cannot modify tasks on a closed Work Order');

    const task = await prisma.maintenanceTask.findFirst({
      where: { id: taskId, organizationId },
    });
    if (!task) throw new NotFoundError('MaintenanceTask', taskId);

    const existing = await prisma.workOrderTask.findFirst({ where: { workOrderId, taskId } });
    if (existing) throw new ConflictError('Task is already on this Work Order');

    return prisma.workOrderTask.create({ data: { workOrderId, taskId } });
  }

  async removeTask(workOrderId: string, taskId: string, organizationId: string) {
    const wo = await this.findOrFail(workOrderId, organizationId);
    if (['QUALITY', 'CLOSED'].includes(wo.status)) {
      throw new ValidationError('Cannot remove tasks when Work Order is in QUALITY or CLOSED status');
    }

    await prisma.workOrderTask.deleteMany({ where: { workOrderId, taskId } });
  }

  // ── Complete a task within a WO ────────────────────────────────────────────
  async completeTask(
    workOrderId: string,
    taskId: string,
    organizationId: string,
    currentUser: { id: string; email: string; role: UserRole },
    notes?: string,
  ) {
    const wo = await this.findOrFail(workOrderId, organizationId);
    if (!['IN_PROGRESS', 'OPEN'].includes(wo.status)) {
      throw new ValidationError('Tasks can only be completed when the Work Order is OPEN or IN_PROGRESS');
    }

    const wot = await prisma.workOrderTask.findFirst({ where: { id: taskId, workOrderId } });
    if (!wot) throw new NotFoundError('WorkOrderTask', taskId);

    const updated = await prisma.workOrderTask.update({
      where: { id: wot.id },
      data: { isCompleted: true, completedAt: new Date(), completedById: currentUser.id, notes },
      include: { task: true, completedBy: { select: { id: true, name: true } } },
    });

    await auditLogService.log({
      organizationId,
      entityType:   'WorkOrderTask',
      entityId:     wot.id,
      action:       'TASK_COMPLETED',
      newValue:     { taskId, taskCode: updated.task?.code, completedById: currentUser.id },
      userId:       currentUser.id,
      userEmail:    currentUser.email,
      userRole:     currentUser.role,
      workOrderId,
    });

    return updated;
  }

  // ── List ───────────────────────────────────────────────────────────────────
  async list(
    organizationId: string,
    filters: { status?: WorkOrderStatus; aircraftId?: string },
  ) {
    return prisma.workOrder.findMany({
      where: {
        organizationId,
        isActive: true,
        ...(filters.status    ? { status:    filters.status }    : {}),
        ...(filters.aircraftId ? { aircraftId: filters.aircraftId } : {}),
      },
      include: {
        aircraft:           { select: { registration: true, model: true } },
        createdBy:          { select: { name: true, role: true } },
        assignedTechnician: { select: { name: true } },
        inspector:          { select: { name: true } },
        tasks:              { include: { task: { select: { code: true, title: true, isMandatory: true } } } },
        _count:             { select: { discrepancies: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Get by ID ──────────────────────────────────────────────────────────────
  async getById(id: string, organizationId: string) {
    const wo = await prisma.workOrder.findFirst({
      where: { id, organizationId, isActive: true },
      include: this.fullInclude,
    });
    if (!wo) throw new NotFoundError('WorkOrder', id);
    return wo;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private async findOrFail(id: string, organizationId: string) {
    const wo = await prisma.workOrder.findFirst({
      where: { id, organizationId, isActive: true },
    });
    if (!wo) throw new NotFoundError('WorkOrder', id);
    return wo;
  }

  /**
   * Validates that all MANDATORY tasks are completed before closing.
   * Throws ValidationError if any blocking tasks remain open.
   */
  private async assertReadyToClose(workOrderId: string) {
    const tasks = await prisma.workOrderTask.findMany({
      where:   { workOrderId },
      include: { task: { select: { isMandatory: true, code: true } } },
    });

    const blockers = tasks.filter(t => t.task.isMandatory && !t.isCompleted);
    if (blockers.length > 0) {
      const codes = blockers.map(t => t.task.code).join(', ');
      throw new ValidationError(
        `No se puede cerrar la OT: ${blockers.length} tarea(s) obligatoria(s) sin completar: ${codes}`,
      );
    }

    const unactioned = await prisma.discrepancy.count({
      where: { workOrderId, status: 'OPEN', resolutionNotes: null },
    });
    if (unactioned > 0) {
      throw new ValidationError(
        `No se puede cerrar la OT: hay ${unactioned} hallazgo(s) abierto(s) sin acción correctiva`,
      );
    }
  }

  /** Reusable deep include for WO queries */
  private get fullInclude() {
    return {
      aircraft:           { select: { id: true, registration: true, model: true, totalFlightHours: true, totalCycles: true } },
      createdBy:          { select: { id: true, name: true, role: true, licenseNumber: true } },
      assignedTechnician: { select: { id: true, name: true, role: true, licenseNumber: true } },
      inspector:          { select: { id: true, name: true, role: true, licenseNumber: true } },
      closedBy:           { select: { id: true, name: true, role: true, licenseNumber: true } },
      tasks: {
        include: {
          task: {
            select: {
              id: true, code: true, title: true, description: true,
              intervalType: true, intervalHours: true, intervalCycles: true,
              isMandatory: true, requiresInspection: true, estimatedManHours: true,
              referenceType: true, referenceNumber: true,
            },
          },
          completedBy: { select: { id: true, name: true } },
        },
        orderBy: [{ task: { isMandatory: 'desc' as const } }, { task: { code: 'asc' as const } }],
      },
      discrepancies: {
        orderBy: [{ createdAt: 'desc' as const }],
        include: {
          foundBy:    { select: { id: true, name: true } },
          resolvedBy: { select: { id: true, name: true } },
        },
      },
    };
  }
}

export const workOrderService = new WorkOrderService();
