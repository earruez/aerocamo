import { prisma } from '../../infrastructure/database/prisma.client';
import { PrismaAircraftRepository } from '../../infrastructure/database/repositories/PrismaAircraftRepository';
import { AppError } from '../../shared/errors/AppError';
import { ComplianceDueDateService } from './ComplianceDueDateService';
import { auditLogService } from './AuditLogService';
import { WORK_REQUEST_STATE_MACHINE, assertValidTransition } from '../workflows/stateMachines';
import {
  workRequestExecutionEligibilityService,
  type ExecutionEligibilityInput,
} from './WorkRequestExecutionEligibilityService';
import { aircraftUsageService } from './AircraftUsageService';

type WorkRequestItemCategory = 'MAINTENANCE_PLAN' | 'NORMATIVE' | 'COMPONENT_INSPECTION' | 'DISCREPANCY' | 'OTHER';
type WorkRequestItemSourceKind = 'maintenance_plan' | 'component_inspection' | 'discrepancy' | 'compliance_due' | 'manual';
type WorkRequestExecutionType = 'maintenance_application' | 'component_replacement' | 'discrepancy_action';

const AMBER_DAYS = 30;
const AMBER_HOURS = 10;
const SUGGEST_DAYS = 90;
const SUGGEST_HOURS = 50;

const WORK_REQUEST_FLOW_INCLUDE = {
  aircraft: true,
  responsible: true,
  reviewer: { select: { id: true, name: true, email: true, role: true } },
  repairShop: { select: { id: true, code: true, name: true } },
  repairShopContact: { select: { id: true, name: true, role: true, email: true } },
  items: { include: { task: true, component: true, discrepancy: true } },
} as const;

export class WorkRequestService {
  private static aircraftRepo = new PrismaAircraftRepository();
  private static dueDateService = new ComplianceDueDateService();

  private static classifyTask(task: {
    referenceType: string;
    applicablePartNumber: string | null;
    requiresInspection: boolean;
  }): WorkRequestItemCategory {
    if (['AD', 'SB', 'CMR', 'CDCCL', 'MPD', 'ETOPS'].includes(task.referenceType)) {
      return 'NORMATIVE';
    }
    if (task.applicablePartNumber || task.requiresInspection) {
      return 'COMPONENT_INSPECTION';
    }
    return 'MAINTENANCE_PLAN';
  }

  private static async ensureDraft(workRequestId: string, organizationId: string) {
    const wr = await prisma.workRequest.findFirst({ where: { id: workRequestId, organizationId } });
    if (!wr) throw new AppError('Solicitud de Trabajo no encontrada', 404);
    if (wr.status !== 'DRAFT') throw new AppError('Solo se puede editar una ST en borrador', 400);
    return wr;
  }

  private static async createTaskSnapshot(taskId: string, organizationId: string) {
    const task = await prisma.maintenanceTask.findFirst({ where: { id: taskId, organizationId } });
    if (!task) throw new AppError('Tarea no encontrada', 404);
    const requiresComponentTracking = Boolean(task.applicablePartNumber) || Boolean(task.requiresInspection);
    return {
      task,
      payload: {
        taskId: task.id,
        sourceKind: 'maintenance_plan' as WorkRequestItemSourceKind,
        sourceId: task.id,
        executionType: (requiresComponentTracking ? 'component_replacement' : 'maintenance_application') as WorkRequestExecutionType,
        requiresComponentTracking,
        componentDefinitionId: requiresComponentTracking ? task.id : null,
        category: this.classifyTask(task),
        itemCode: task.code,
        itemTitle: task.title,
        itemDescription: task.description,
      },
    };
  }

  private static isChapter0405(taskCode: string, referenceNumber: string | null): boolean {
    const candidate = `${taskCode} ${referenceNumber ?? ''}`.toUpperCase();
    return /(^|\s)(04|05)([\-./]|\s|$)/.test(candidate) || /ATA\s*(04|05)/.test(candidate);
  }

  private static async nextNumber(organizationId: string): Promise<string> {
    const last = await prisma.workRequest.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: { number: true },
    });

    const year = new Date().getFullYear();
    const seq = last ? Number(last.number.split('-').pop() ?? '0') + 1 : 1;
    return `ST-${year}-${String(seq).padStart(4, '0')}`;
  }

  static async getOpenDraftByAircraft(aircraftId: string, organizationId: string) {
    return prisma.workRequest.findFirst({
      where: { aircraftId, organizationId, status: 'DRAFT' },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async createDraft(input: {
    aircraftId: string;
    organizationId: string;
    createdById: string;
    taskIds?: string[];
  }) {
    const aircraft = await prisma.aircraft.findFirst({
      where: { id: input.aircraftId, organizationId: input.organizationId },
    });
    if (!aircraft) throw new AppError('Aircraft not found', 404);

    const number = await this.nextNumber(input.organizationId);

    const wr = await prisma.workRequest.create({
      data: {
        number,
        organizationId: input.organizationId,
        aircraftId: input.aircraftId,
        createdById: input.createdById,
        aircraftHoursAtRequest: aircraft.totalFlightHours,
        aircraftCyclesN1: aircraft.totalCycles,
        aircraftCyclesN2: null,
        items: input.taskIds?.length
          ? {
              create: await Promise.all(input.taskIds.map(async (taskId) => {
                const { payload } = await this.createTaskSnapshot(taskId, input.organizationId);
                return { ...payload, source: 'AUTO' };
              })),
            }
          : undefined,
      },
      include: {
        items: { include: { task: true, component: true, discrepancy: true } },
        aircraft: true,
        responsible: true,
      },
    });

    return wr;
  }

  static async getOrCreateDraftWithTask(input: {
    aircraftId: string;
    organizationId: string;
    createdById: string;
    taskId: string;
    source?: 'AUTO' | 'MANUAL';
  }) {
    let draft = await this.getOpenDraftByAircraft(input.aircraftId, input.organizationId);
    if (!draft) {
      draft = await this.createDraft({
        aircraftId: input.aircraftId,
        organizationId: input.organizationId,
        createdById: input.createdById,
      });
    }

    await this.addItem(draft.id, input.organizationId, { taskId: input.taskId, source: input.source ?? 'AUTO' });

    return this.getById(draft.id, input.organizationId);
  }

  static async getById(id: string, organizationId: string) {
    const wr = await prisma.workRequest.findFirst({
      where: { id, organizationId },
      include: {
        aircraft: true,
        responsible: true,
        createdBy: true,
        reviewer: { select: { id: true, name: true, email: true, role: true } },
        repairShop: { select: { id: true, code: true, name: true } },
        repairShopContact: { select: { id: true, name: true, role: true, email: true, phone: true } },
        items: { include: { task: true, component: true, discrepancy: true }, orderBy: { addedAt: 'asc' } },
      },
    });
    if (!wr) throw new AppError('Solicitud de Trabajo no encontrada', 404);
    return wr;
  }

  static async listByAircraft(aircraftId: string, organizationId: string) {
    return prisma.workRequest.findMany({
      where: { aircraftId, organizationId },
      include: { responsible: true, items: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  static async listResponsibles(organizationId: string) {
    return prisma.user.findMany({
      where: {
        organizationId,
        isActive: true,
        role: { in: ['ADMIN', 'SUPERVISOR', 'INSPECTOR'] },
      },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  static async addItem(
    workRequestId: string,
    organizationId: string,
    input: {
      taskId?: string;
      componentId?: string;
      discrepancyId?: string;
      sourceKind?: WorkRequestItemSourceKind;
      sourceId?: string;
      executionType?: WorkRequestExecutionType | null;
      requiresComponentTracking?: boolean;
      componentDefinitionId?: string | null;
      category?: WorkRequestItemCategory;
      code?: string | null;
      title?: string;
      description?: string | null;
      source?: string;
    },
  ) {
    const wr = await this.ensureDraft(workRequestId, organizationId);

    let payload: {
      taskId?: string | null;
      componentId?: string | null;
      discrepancyId?: string | null;
      sourceKind: WorkRequestItemSourceKind;
      sourceId: string;
      executionType?: WorkRequestExecutionType | null;
      requiresComponentTracking: boolean;
      componentDefinitionId?: string | null;
      category: WorkRequestItemCategory;
      itemCode?: string | null;
      itemTitle: string;
      itemDescription?: string | null;
    };

    if (input.taskId) {
      const taskSnapshot = await this.createTaskSnapshot(input.taskId, organizationId);
      payload = taskSnapshot.payload;
    } else if (input.componentId) {
      const component = await prisma.component.findFirst({
        where: { id: input.componentId, organizationId, aircraftId: wr.aircraftId },
      });
      if (!component) throw new AppError('Componente no encontrado para esta aeronave', 404);
      payload = {
        componentId: component.id,
        sourceKind: 'component_inspection',
        sourceId: component.id,
        executionType: 'component_replacement',
        requiresComponentTracking: true,
        componentDefinitionId: component.id,
        category: 'COMPONENT_INSPECTION',
        itemCode: component.partNumber,
        itemTitle: `${component.description}`,
        itemDescription: `Componente S/N ${component.serialNumber}${component.position ? ` · Posición ${component.position}` : ''}`,
      };
    } else if (input.discrepancyId) {
      const discrepancy = await prisma.discrepancy.findFirst({
        where: {
          id: input.discrepancyId,
          organizationId,
          workOrder: { aircraftId: wr.aircraftId },
        },
      });
      if (!discrepancy) throw new AppError('Discrepancia no encontrada para esta aeronave', 404);
      payload = {
        discrepancyId: discrepancy.id,
        sourceKind: 'discrepancy',
        sourceId: discrepancy.id,
        executionType: 'discrepancy_action',
        requiresComponentTracking: false,
        componentDefinitionId: null,
        category: 'DISCREPANCY',
        itemCode: discrepancy.code,
        itemTitle: discrepancy.title,
        itemDescription: discrepancy.description,
      };
    } else {
      if (!input.title) throw new AppError('Título requerido para ítem manual', 400);
      const sourceKind = input.sourceKind ?? 'manual';
      const sourceId = input.sourceId?.trim()
        || (sourceKind === 'manual' ? `manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}` : '');

      if (!sourceId) {
        throw new AppError('sourceId es requerido para ítems no manuales sin task/component/discrepancy', 400);
      }

      payload = {
        sourceKind,
        sourceId,
        executionType: input.executionType ?? null,
        requiresComponentTracking: input.requiresComponentTracking ?? false,
        componentDefinitionId: input.componentDefinitionId ?? null,
        category: input.category ?? 'OTHER',
        itemCode: input.code ?? null,
        itemTitle: input.title,
        itemDescription: input.description ?? null,
      };
    }

    const exists = await prisma.workRequestItem.findFirst({
      where: {
        workRequestId,
        OR: [
          payload.taskId ? { taskId: payload.taskId } : undefined,
          payload.componentId ? { componentId: payload.componentId } : undefined,
          payload.discrepancyId ? { discrepancyId: payload.discrepancyId } : undefined,
          !payload.taskId && !payload.componentId && !payload.discrepancyId
            ? { sourceKind: payload.sourceKind, sourceId: payload.sourceId }
            : undefined,
          !payload.taskId && !payload.componentId && !payload.discrepancyId
            ? { itemTitle: payload.itemTitle, category: payload.category }
            : undefined,
        ].filter(Boolean) as never,
      },
    });

    if (!exists) {
      await prisma.workRequestItem.create({
        data: {
          workRequestId,
          source: input.source ?? 'MANUAL',
          ...payload,
        },
      });
    }

    return this.getById(workRequestId, organizationId);
  }

  static async removeItem(workRequestId: string, itemId: string, organizationId: string) {
    await this.ensureDraft(workRequestId, organizationId);
    await prisma.workRequestItem.deleteMany({ where: { id: itemId, workRequestId } });
    return this.getById(workRequestId, organizationId);
  }

  static async getExecutionEligibility(input: ExecutionEligibilityInput) {
    return workRequestExecutionEligibilityService.evaluate(input);
  }

  static async updateDraft(
    workRequestId: string,
    organizationId: string,
    data: { responsibleId?: string | null; notes?: string | null },
  ) {
    const wr = await prisma.workRequest.findFirst({ where: { id: workRequestId, organizationId } });
    if (!wr) throw new AppError('Solicitud de Trabajo no encontrada', 404);
    if (wr.status !== 'DRAFT') throw new AppError('Solo se puede editar una ST en borrador', 400);

    return prisma.workRequest.update({
      where: { id: workRequestId },
      data: { responsibleId: data.responsibleId ?? null, notes: data.notes ?? null },
    });
  }

  static async getCatalog(aircraftId: string, organizationId: string, search?: string) {
    const plan = await this.aircraftRepo.getMaintenancePlan(aircraftId, organizationId);

    const matchesSearch = (value: string) => search ? value.toLowerCase().includes(search.toLowerCase()) : true;

    const maintenancePlan = plan.filter((item) => {
      const byHours = item.hoursRemaining != null && item.hoursRemaining > AMBER_HOURS && item.hoursRemaining <= SUGGEST_HOURS;
      const byDays = item.daysRemaining != null && item.daysRemaining > AMBER_DAYS && item.daysRemaining <= SUGGEST_DAYS;
      return item.status === 'OK' && matchesSearch(`${item.taskCode} ${item.taskTitle}`) && (byHours || byDays);
    });

    const normative = plan.filter((item) =>
      ['AD', 'SB', 'CMR', 'CDCCL', 'MPD', 'ETOPS'].includes(item.referenceType)
      && matchesSearch(`${item.taskCode} ${item.taskTitle} ${item.referenceNumber ?? ''}`),
    );

    const componentInspection = plan.filter((item) =>
      (item.referenceType === 'AMM' || item.taskTitle.toLowerCase().includes('inspect'))
      && matchesSearch(`${item.taskCode} ${item.taskTitle}`),
    );

    const components = await prisma.component.findMany({
      where: {
        organizationId,
        aircraftId,
        isActive: true,
        OR: search ? [
          { partNumber: { contains: search, mode: 'insensitive' } },
          { serialNumber: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ] : undefined,
      },
      orderBy: { partNumber: 'asc' },
    });

    const discrepancies = await prisma.discrepancy.findMany({
      where: {
        organizationId,
        status: { in: ['OPEN', 'DEFERRED'] },
        workOrder: { aircraftId },
        OR: search ? [
          { code: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ] : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    return {
      maintenancePlan,
      normative,
      componentInspection,
      components,
      discrepancies,
    };
  }

  /** Pasa la ST a revisión: quien la armó la entrega a un revisor antes de que salga. */
  static async submitForReview(input: {
    workRequestId: string;
    organizationId: string;
    reviewerId: string;
    actorId: string;
  }) {
    const wr = await this.getById(input.workRequestId, input.organizationId);
    assertValidTransition(WORK_REQUEST_STATE_MACHINE, wr.status, 'IN_REVIEW', 'Work Request');
    if (wr.items.length === 0) throw new AppError('La ST no tiene tareas incluidas', 400);

    const reviewer = await prisma.user.findFirst({
      where: { id: input.reviewerId, organizationId: input.organizationId, isActive: true },
      select: { id: true },
    });
    if (!reviewer) throw new AppError('Revisor no encontrado', 404);

    return prisma.workRequest.update({
      where: { id: wr.id },
      data: { status: 'IN_REVIEW', reviewerId: reviewer.id },
      include: WORK_REQUEST_FLOW_INCLUDE,
    });
  }

  /** El revisor aprueba y la ST vuelve a quedar lista para enviarse. */
  static async approveReview(input: {
    workRequestId: string;
    organizationId: string;
    actorId: string;
    approved: boolean;
    reviewNotes?: string | null;
  }) {
    const wr = await this.getById(input.workRequestId, input.organizationId);
    if (wr.status !== 'IN_REVIEW') throw new AppError('La ST no está en revisión', 400);

    // Rechazar devuelve la ST a borrador con el motivo, para corregirla.
    const nextStatus = input.approved ? 'IN_REVIEW' : 'DRAFT';
    if (!input.approved && !input.reviewNotes?.trim()) {
      throw new AppError('Indique qué debe corregirse al devolver la ST', 400);
    }

    return prisma.workRequest.update({
      where: { id: wr.id },
      data: {
        status: nextStatus,
        reviewedAt: input.approved ? new Date() : null,
        reviewNotes: input.reviewNotes?.trim() || null,
      },
      include: WORK_REQUEST_FLOW_INCLUDE,
    });
  }

  /** Registra la OT que devuelve el taller: es el respaldo para poder cerrar. */
  static async registerReceivedOt(input: {
    workRequestId: string;
    organizationId: string;
    actorId: string;
    otNumber: string;
    otReceivedAt?: Date | null;
    otDocumentUrl?: string | null;
  }) {
    const wr = await this.getById(input.workRequestId, input.organizationId);
    assertValidTransition(WORK_REQUEST_STATE_MACHINE, wr.status, 'OT_RECEIVED', 'Work Request');
    if (!input.otNumber.trim()) throw new AppError('Indique el número de la OT recibida', 400);

    return prisma.workRequest.update({
      where: { id: wr.id },
      data: {
        status: 'OT_RECEIVED',
        otNumber: input.otNumber.trim().slice(0, 80),
        otReceivedAt: input.otReceivedAt ?? new Date(),
        otDocumentUrl: input.otDocumentUrl ?? null,
        otRegisteredById: input.actorId,
      },
      include: WORK_REQUEST_FLOW_INCLUDE,
    });
  }

  /**
   * Cancela la ST conservando el registro. Una vez enviada, la solicitud es parte
   * del expediente: se anula con motivo, no se borra.
   */
  static async cancel(input: {
    workRequestId: string;
    organizationId: string;
    actorId: string;
    reason: string;
  }) {
    const wr = await this.getById(input.workRequestId, input.organizationId);
    assertValidTransition(WORK_REQUEST_STATE_MACHINE, wr.status, 'CANCELLED', 'Work Request');
    if (!input.reason.trim()) throw new AppError('Indique el motivo de la cancelación', 400);

    const actor = await prisma.user.findFirst({
      where: { id: input.actorId, organizationId: input.organizationId },
      select: { email: true, role: true },
    });
    if (!actor) throw new AppError('Usuario no encontrado para auditoría', 404);

    const cancelled = await prisma.workRequest.update({
      where: { id: wr.id },
      data: {
        status: 'CANCELLED',
        closedAt: new Date(),
        closedById: input.actorId,
        notes: [wr.notes?.trim() || null, `[CANCELADA] ${input.reason.trim()}`]
          .filter(Boolean).join('\n'),
      },
      include: WORK_REQUEST_FLOW_INCLUDE,
    });

    await auditLogService.log({
      organizationId: input.organizationId,
      entityType: 'WorkRequest',
      entityId: wr.id,
      action: 'CANCEL',
      previousValue: { status: wr.status },
      newValue: { status: 'CANCELLED', reason: input.reason.trim() },
      userId: input.actorId,
      userEmail: actor.email,
      userRole: actor.role,
      metadata: { workRequestNumber: wr.number, itemsCount: wr.items.length },
    });

    return cancelled;
  }

  /**
   * Elimina definitivamente una ST. Solo en borrador: una vez enviada existe
   * fuera de la plataforma —el taller la recibió— y debe cancelarse, no borrarse.
   */
  static async remove(input: { workRequestId: string; organizationId: string; actorId: string }) {
    const wr = await this.getById(input.workRequestId, input.organizationId);
    if (wr.status !== 'DRAFT') {
      throw new AppError(
        'Solo se puede eliminar una solicitud en borrador. Si ya fue enviada, cancélala para conservar el registro.',
        400,
      );
    }

    const actor = await prisma.user.findFirst({
      where: { id: input.actorId, organizationId: input.organizationId },
      select: { email: true, role: true },
    });
    if (!actor) throw new AppError('Usuario no encontrado para auditoría', 404);

    // Los ítems caen en cascada; nada más cuelga de un borrador.
    await prisma.workRequest.delete({ where: { id: wr.id } });

    await auditLogService.log({
      organizationId: input.organizationId,
      entityType: 'WorkRequest',
      entityId: wr.id,
      action: 'DELETE',
      previousValue: { number: wr.number, status: wr.status, itemsCount: wr.items.length },
      newValue: null,
      userId: input.actorId,
      userEmail: actor.email,
      userRole: actor.role,
      metadata: { workRequestNumber: wr.number, aircraftId: wr.aircraftId },
    });

    return { id: wr.id, number: wr.number };
  }

  static async send(
    workRequestId: string,
    organizationId: string,
    sentById: string,
    dispatch?: {
      repairShopId?: string | null;
      repairShopContactId?: string | null;
      /** MANUAL cubre el caso del taller que recibe el PDF impreso en mano. */
      dispatchMethod?: 'EMAIL' | 'MANUAL' | null;
      dispatchNotes?: string | null;
    },
  ) {
    const wr = await this.getById(workRequestId, organizationId);
    assertValidTransition(WORK_REQUEST_STATE_MACHINE, wr.status, 'SENT', 'Work Request');
    // El destino puede ser un contacto del taller o un responsable interno:
    // basta con que la ST sepa a quién va.
    const destinationContactId = dispatch?.repairShopContactId ?? wr.repairShopContactId;
    if (!wr.responsibleId && !destinationContactId) {
      throw new AppError('Asigne un responsable o un contacto del taller antes de enviar', 400);
    }
    if (wr.items.length === 0) throw new AppError('La ST no tiene tareas incluidas', 400);

    // Enviar por correo exige un contacto con dirección; en mano no.
    if (dispatch?.dispatchMethod === 'EMAIL' && dispatch.repairShopContactId) {
      const contact = await prisma.repairShopContact.findFirst({
        where: { id: dispatch.repairShopContactId, organizationId },
        select: { email: true },
      });
      if (!contact?.email) throw new AppError('El contacto seleccionado no tiene correo registrado', 400);
    }

    const sent = await prisma.workRequest.update({
      where: { id: workRequestId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        sentById,
        repairShopId: dispatch?.repairShopId ?? undefined,
        repairShopContactId: dispatch?.repairShopContactId ?? undefined,
        dispatchMethod: dispatch?.dispatchMethod ?? undefined,
        dispatchNotes: dispatch?.dispatchNotes?.trim() || undefined,
      },
      include: { responsible: true, aircraft: true, items: { include: { task: true, component: true, discrepancy: true } } },
    });

    const actor = await prisma.user.findFirst({
      where: { id: sentById, organizationId },
      select: { email: true, role: true },
    });
    if (!actor) throw new AppError('Usuario no encontrado para auditoría', 404);

    await auditLogService.log({
      organizationId,
      entityType: 'WorkRequest',
      entityId: wr.id,
      action: 'SEND',
      previousValue: { status: wr.status, sentAt: wr.sentAt },
      newValue: { status: sent.status, sentAt: sent.sentAt, sentById },
      userId: sentById,
      userEmail: actor.email,
      userRole: actor.role,
      metadata: {
        workRequestNumber: wr.number,
        aircraftId: wr.aircraftId,
        itemsCount: wr.items.length,
      },
    });

    return sent;
  }

  static async closeAndComply(input: {
    workRequestId: string;
    organizationId: string;
    user: { id: string; name?: string; email: string; role: string };
    aircraftHoursAtClose?: number;
    aircraftCyclesN1AtClose?: number;
    aircraftCyclesN2AtClose?: number;
    closedAt?: Date;
    evidenceFileUrl: string;
    evidenceFileName: string;
    notes?: string | null;
  }) {
    const wr = await prisma.workRequest.findFirst({
      where: { id: input.workRequestId, organizationId: input.organizationId },
      include: {
        items: { include: { task: true } },
      },
    });

    if (!wr) throw new AppError('Solicitud de Trabajo no encontrada', 404);
    if (wr.status !== 'OT_RECEIVED' && wr.status !== 'SENT') {
      throw new AppError('La ST debe estar en estado ENVIADA antes de cerrar y cumplir', 400);
    }

    const closeDate = input.closedAt ?? new Date();
  const usageSummary = await aircraftUsageService.getAircraftUsageSummary(wr.aircraftId, input.organizationId);
  const masterHoursAtClose = usageSummary.totalHours;
  const masterCyclesAtClose = usageSummary.totalCycles;

    const taskItems = wr.items.filter((item) => !!item.taskId && !!item.task);
    if (taskItems.length === 0) {
      throw new AppError('La ST no contiene tareas con cumplimiento registrable', 400);
    }

    const existingComplianceCount = await prisma.compliance.count({
      where: {
        organizationId: input.organizationId,
        aircraftId: wr.aircraftId,
        workOrderNumber: wr.number,
      },
    });
    if (existingComplianceCount > 0) {
      throw new AppError('Esta ST ya fue cerrada y cumplida previamente', 400);
    }

    const created = await prisma.$transaction(async (tx) => {
      const createdRows: Array<{ id: string }> = [];

      for (const item of taskItems) {
        const task = item.task!;
          const taskForDue: import('../entities/MaintenanceTask').MaintenanceTask = {
            ...task,
            intervalHours: task.intervalHours != null ? Number(task.intervalHours) : null,
            intervalCycles: task.intervalCycles,
            intervalCalendarDays: task.intervalCalendarDays,
            intervalCalendarMonths: task.intervalCalendarMonths,
            toleranceHours: task.toleranceHours != null ? Number(task.toleranceHours) : null,
            toleranceCycles: task.toleranceCycles,
            toleranceCalendarDays: task.toleranceCalendarDays,
            estimatedManHours: task.estimatedManHours != null ? Number(task.estimatedManHours) : null,
          };
        const computed = this.dueDateService.calculate(
            taskForDue,
          masterHoursAtClose,
          masterCyclesAtClose,
          closeDate,
        );

        const legalRef = `${task.referenceType}${task.referenceNumber ? ` ${task.referenceNumber}` : ''}`;
        const noteParts = [
          `ST ${wr.number}`,
          `Sustento ${legalRef}`,
          `Evidencia ${input.evidenceFileUrl}`,
          `Archivo ${input.evidenceFileName}`,
          `Master FH ${masterHoursAtClose}`,
          `Master CYC ${masterCyclesAtClose}`,
          input.aircraftHoursAtClose != null ? `Snapshot cliente FH ${input.aircraftHoursAtClose}` : null,
          input.aircraftCyclesN1AtClose != null ? `Snapshot cliente CYC N1 ${input.aircraftCyclesN1AtClose}` : null,
          input.aircraftCyclesN2AtClose != null ? `Snapshot cliente CYC N2 ${input.aircraftCyclesN2AtClose}` : null,
          input.notes?.trim() ?? null,
        ].filter(Boolean);

        const compliance = await tx.compliance.create({
          data: {
            organizationId: input.organizationId,
            aircraftId: wr.aircraftId,
            taskId: item.taskId!,
            componentId: item.componentId ?? null,
            performedById: input.user.id,
            performedAt: closeDate,
            aircraftHoursAtCompliance: masterHoursAtClose,
            aircraftCyclesAtCompliance: masterCyclesAtClose,
            nextDueHours: computed.nextDueHours,
            nextDueCycles: computed.nextDueCycles,
            nextDueDate: computed.nextDueDate,
            workOrderNumber: wr.number,
            notes: noteParts.join(' | '),
          },
          select: { id: true },
        });
        createdRows.push(compliance);
      }

      await tx.workRequest.update({
        where: { id: wr.id },
        data: {
          status: 'CLOSED',
          closedAt: closeDate,
          closedById: input.user.id,
          notes: [
            wr.notes?.trim() ?? null,
            `[CLOSE_AND_COMPLY ${closeDate.toISOString()}] MASTER_FH ${masterHoursAtClose} MASTER_CYC ${masterCyclesAtClose} SNAPSHOT_FH ${input.aircraftHoursAtClose ?? 'n/a'} SNAPSHOT_CYC_N1 ${input.aircraftCyclesN1AtClose ?? 'n/a'} SNAPSHOT_CYC_N2 ${input.aircraftCyclesN2AtClose ?? 'n/a'} EVIDENCE ${input.evidenceFileName}`,
          ].filter(Boolean).join('\n'),
        },
      });

      return createdRows;
    });

    await aircraftUsageService.recordUsage({
      organizationId: input.organizationId,
      aircraftId: wr.aircraftId,
      date: closeDate,
      totalHours: masterHoursAtClose,
      totalCycles: masterCyclesAtClose,
      source: 'ot_close',
      notes: `Cierre ST ${wr.number} con evidencia ${input.evidenceFileName}`,
      updateMaster: false,
    });

    await auditLogService.log({
      organizationId: input.organizationId,
      entityType: 'WorkRequest',
      entityId: wr.id,
      action: 'CLOSE_AND_COMPLY',
      previousValue: { status: wr.status },
      newValue: {
        status: wr.status,
        generatedCompliances: created.length,
        workRequestNumber: wr.number,
      },
      userId: input.user.id,
      userEmail: input.user.email,
      userRole: input.user.role,
      metadata: {
        message: `Usuario ${input.user.name ?? input.user.email} cerró ST ${wr.number} y generó ${created.length} cumplimientos legales`,
        evidenceFileUrl: input.evidenceFileUrl,
        evidenceFileName: input.evidenceFileName,
        aircraftUsageMaster: {
          totalHours: masterHoursAtClose,
          totalCycles: masterCyclesAtClose,
        },
      },
    });

    return {
      workRequestId: wr.id,
      workRequestNumber: wr.number,
      generatedCompliances: created.length,
      evidenceFileUrl: input.evidenceFileUrl,
      closedAt: closeDate.toISOString(),
    };
  }

  static async getAirworthinessHistory(aircraftId: string, organizationId: string) {
    const rows = await prisma.compliance.findMany({
      where: {
        aircraftId,
        organizationId,
        workOrderNumber: { startsWith: 'ST-' },
      },
      include: {
        task: {
          select: {
            code: true,
            title: true,
            referenceType: true,
            referenceNumber: true,
          },
        },
      },
      orderBy: { performedAt: 'desc' },
      take: 500,
    });

    return rows.map((row) => {
      const evidenceMatch = row.notes?.match(/Evidencia\s([^|]+)/i);
      const legalInNotes = row.notes?.match(/Sustento\s([^|]+)/i);
      return {
        id: row.id,
        date: row.performedAt,
        taskCode: row.task.code,
        taskTitle: row.task.title,
        flightHours: Number(row.aircraftHoursAtCompliance),
        cycles: row.aircraftCyclesAtCompliance,
        legalBasis: legalInNotes?.[1]?.trim() || `${row.task.referenceType}${row.task.referenceNumber ? ` / ${row.task.referenceNumber}` : ''}`,
        evidenceUrl: evidenceMatch?.[1]?.trim() ?? null,
        workRequestNumber: row.workOrderNumber,
      };
    });
  }

  static async runDailyAutoGenerationForAllOrganizations(): Promise<{ created: number; updated: number; scanned: number }> {
    const aircraftList = await prisma.aircraft.findMany({
      where: { isActive: true, status: { not: 'DECOMMISSIONED' } },
      select: { id: true, organizationId: true },
    });

    let created = 0;
    let updated = 0;
    let scanned = 0;

    for (const a of aircraftList) {
      const plan = await this.aircraftRepo.getMaintenancePlan(a.id, a.organizationId);
      const amber = plan.filter((item) => {
        const byHours = item.hoursRemaining != null && item.hoursRemaining <= AMBER_HOURS;
        const byDays = item.daysRemaining != null && item.daysRemaining <= AMBER_DAYS;
        return (byHours || byDays || item.status === 'OVERDUE')
          && this.isChapter0405(item.taskCode, item.referenceNumber);
      });

      if (amber.length === 0) {
        scanned += plan.length;
        continue;
      }

      let draft = await this.getOpenDraftByAircraft(a.id, a.organizationId);
      const hadDraft = !!draft;
      if (!draft) {
        const fallbackUser = await prisma.user.findFirst({
          where: {
            organizationId: a.organizationId,
            isActive: true,
            role: { in: ['ADMIN', 'SUPERVISOR'] },
          },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });

        if (!fallbackUser) {
          scanned += plan.length;
          continue;
        }

        draft = await this.createDraft({
          aircraftId: a.id,
          organizationId: a.organizationId,
          createdById: fallbackUser.id,
        });
      }

      // Lo que el borrador ya trae no se vuelve a agregar. skipDuplicates por sí
      // solo no bastaba: omite filas que chocan con una restricción única, y no
      // existía ninguna, así que cada corrida del job repetía las mismas tareas.
      const existingTaskIds = new Set(
        (await prisma.workRequestItem.findMany({
          where: { workRequestId: draft.id, taskId: { not: null } },
          select: { taskId: true },
        })).map((row) => row.taskId as string),
      );
      const pending = amber.filter((item) => !existingTaskIds.has(item.taskId));

      const result = pending.length === 0
        ? { count: 0 }
        : await prisma.workRequestItem.createMany({
          data: await Promise.all(pending.map(async (item) => {
            const { payload } = await this.createTaskSnapshot(item.taskId, a.organizationId);
            return { workRequestId: draft.id, source: 'AUTO', ...payload };
          })),
          skipDuplicates: true,
        });

      if (result.count > 0) {
        if (hadDraft) updated += result.count;
        else created += 1;
      }
      scanned += plan.length;
    }

    return { created, updated, scanned };
  }
}
