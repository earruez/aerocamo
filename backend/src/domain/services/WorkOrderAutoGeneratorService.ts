import { UserRole } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.client';
import { NotFoundError } from '../../shared/errors/AppError';
import { dueEngineService, DueSourceType } from './DueEngineService';
import { workOrderService } from './WorkOrderService';

/** Tipos de fila del Due Engine que tienen una MaintenanceTask real detrás
 *  (COMPONENT/ENGINE_COMPONENT son control de componentes, no tareas). */
const TASK_SOURCE_TYPES: DueSourceType[] = ['AD', 'SB', 'INSPECTION', 'MIM', 'DAN', 'MOD'];

export interface GeneratePendingResult {
  generated: boolean;
  message: string;
  workOrder?: Awaited<ReturnType<typeof workOrderService.create>>;
}

/**
 * WorkOrderAutoGeneratorService
 * Genera Órdenes de Trabajo a partir de tareas vencidas o próximas a vencer,
 * usando el mismo Due Engine que ya calculan Cumplimientos y Remanentes.
 */
export class WorkOrderAutoGeneratorService {
  /**
   * Agrupa en UNA sola OT (borrador) todas las tareas vencidas/próximas de la
   * aeronave que aún no estén en una OT abierta. No crea nada si no hay
   * tareas elegibles, así un doble clic no genera OT vacías ni duplicadas.
   */
  static async generatePendingForAircraft(
    aircraftId: string,
    organizationId: string,
    currentUser: { id: string; email: string; role: UserRole },
  ): Promise<GeneratePendingResult> {
    const aircraft = await prisma.aircraft.findFirst({ where: { id: aircraftId, organizationId } });
    if (!aircraft) throw new NotFoundError('Aircraft', aircraftId);

    const dueRows = await dueEngineService.getDueRows(organizationId, aircraftId);

    const eligible = dueRows.filter(
      (row) =>
        TASK_SOURCE_TYPES.includes(row.sourceType) &&
        row.isApplicable &&
        (row.status === 'OVERDUE' || row.status === 'DUE_SOON'),
    );

    if (eligible.length === 0) {
      return { generated: false, message: 'No hay tareas vencidas ni próximas a vencer para esta aeronave.' };
    }

    // No repetir una tarea que ya está en una OT sin cerrar de esta aeronave.
    const openTasks = await prisma.workOrderTask.findMany({
      where: { workOrder: { aircraftId, organizationId, status: { not: 'CLOSED' } } },
      select: { taskId: true },
    });
    const alreadyOpen = new Set(openTasks.map((t) => t.taskId));

    const pending = eligible.filter((row) => !alreadyOpen.has(row.sourceId));
    const taskIds = [...new Set(pending.map((row) => row.sourceId))];

    if (taskIds.length === 0) {
      return { generated: false, message: 'Las tareas vencidas o próximas ya están en una OT abierta.' };
    }

    const overdueCount = pending.filter((r) => r.status === 'OVERDUE').length;
    const dueSoonCount = taskIds.length - overdueCount;
    const parts = [
      overdueCount > 0 ? `${overdueCount} vencida${overdueCount === 1 ? '' : 's'}` : null,
      dueSoonCount > 0 ? `${dueSoonCount} próxima${dueSoonCount === 1 ? '' : 's'} a vencer` : null,
    ].filter(Boolean);
    const title = `Mantenimiento programado — ${parts.join(' y ')}`;
    const description = pending.map((row) => `${row.taskCode} — ${row.description}`).join('\n');

    const workOrder = await workOrderService.create(
      { aircraftId, title, description, taskIds },
      organizationId,
      currentUser,
    );

    return {
      generated: true,
      message: `OT ${workOrder.number} creada con ${taskIds.length} tarea${taskIds.length === 1 ? '' : 's'}.`,
      workOrder,
    };
  }

  /**
   * Obtener todas las OT pendientes de asignación para una organización
   */
  static async getPendingAssignmentWorkOrders(organizationId: string): Promise<any[]> {
    return prisma.workOrder.findMany({
      where: {
        organizationId,
        assignmentStatus: 'PENDING',
      },
      include: {
        aircraft: {
          select: { id: true, registration: true, model: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        tasks: {
          include: { task: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Obtener contador de OT pendientes por aeronave
   */
  static async getPendingCountByAircraft(
    aircraftId: string,
    organizationId: string
  ): Promise<number> {
    return prisma.workOrder.count({
      where: {
        organizationId,
        aircraftId,
        assignmentStatus: 'PENDING',
      },
    });
  }
}
