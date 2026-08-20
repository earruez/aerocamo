import { prisma } from '../../infrastructure/database/prisma.client';
import { ComplianceDueDateService } from './ComplianceDueDateService';
import type { MaintenanceTask } from '../entities/MaintenanceTask';

export const BASELINE_NOTE = 'Inicio de control';

function mapTask(row: {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  description: string;
  intervalType: MaintenanceTask['intervalType'];
  intervalHours: unknown;
  intervalCycles: number | null;
  intervalCalendarDays: number | null;
  intervalCalendarMonths: number | null;
  toleranceHours: unknown;
  toleranceCycles: number | null;
  toleranceCalendarDays: number | null;
  referenceNumber: string | null;
  referenceType: MaintenanceTask['referenceType'];
  isMandatory: boolean;
  estimatedManHours: unknown;
  requiresInspection: boolean;
  applicableModel: string | null;
  applicablePartNumber: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): MaintenanceTask {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    title: row.title,
    description: row.description,
    intervalType: row.intervalType,
    intervalHours: row.intervalHours != null ? Number(row.intervalHours) : null,
    intervalCycles: row.intervalCycles,
    intervalCalendarDays: row.intervalCalendarDays,
    intervalCalendarMonths: row.intervalCalendarMonths,
    toleranceHours: row.toleranceHours != null ? Number(row.toleranceHours) : null,
    toleranceCycles: row.toleranceCycles,
    toleranceCalendarDays: row.toleranceCalendarDays,
    referenceNumber: row.referenceNumber,
    referenceType: row.referenceType,
    isMandatory: row.isMandatory,
    estimatedManHours: row.estimatedManHours != null ? Number(row.estimatedManHours) : null,
    requiresInspection: row.requiresInspection,
    applicableModel: row.applicableModel,
    applicablePartNumber: row.applicablePartNumber,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class BaselineComplianceService {
  private static readonly due = new ComplianceDueDateService();

  private static async resolvePerformedById(
    organizationId: string,
    preferredId?: string,
  ): Promise<string | null> {
    if (preferredId) {
      const preferred = await prisma.user.findFirst({
        where: { id: preferredId, organizationId, isActive: true },
        select: { id: true },
      });
      if (preferred) return preferred.id;
    }

    const fallback = await prisma.user.findFirst({
      where: { organizationId, isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    return fallback?.id ?? null;
  }

  static async ensureBaselinesForAircraft(
    aircraftId: string,
    organizationId: string,
    performedById?: string,
  ): Promise<number> {
    const resolvedPerformedById = await this.resolvePerformedById(organizationId, performedById);
    if (!resolvedPerformedById) return 0;

    const aircraft = await prisma.aircraft.findFirst({
      where: { id: aircraftId, organizationId },
      select: {
        id: true,
        organizationId: true,
        createdAt: true,
        totalFlightHours: true,
        totalCycles: true,
      },
    });

    if (!aircraft) return 0;

    const links = await prisma.aircraftTask.findMany({
      where: {
        aircraftId,
        isActive: true,
        aircraft: { organizationId },
        task: { isActive: true },
      },
      include: {
        task: {
          select: {
            id: true,
            organizationId: true,
            code: true,
            title: true,
            description: true,
            intervalType: true,
            intervalHours: true,
            intervalCycles: true,
            intervalCalendarDays: true,
            intervalCalendarMonths: true,
            toleranceHours: true,
            toleranceCycles: true,
            toleranceCalendarDays: true,
            referenceNumber: true,
            referenceType: true,
            isMandatory: true,
            estimatedManHours: true,
            requiresInspection: true,
            applicableModel: true,
            applicablePartNumber: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    const tasks = links.map((link) => link.task);

    if (tasks.length === 0) return 0;

    const existing = await prisma.compliance.findMany({
      where: {
        organizationId,
        aircraftId,
        taskId: { in: tasks.map((t) => t.id) },
        OR: [
          { applicationType: 'baseline' },
          { notes: BASELINE_NOTE },
        ],
      },
      select: { taskId: true },
    });

    const existingTaskIds = new Set(existing.map((x) => x.taskId));
    const hoursAtApplication = Number(aircraft.totalFlightHours);
    const cyclesAtApplication = aircraft.totalCycles;
    const performedAt = aircraft.createdAt;

    const rows = tasks
      .filter((task) => !existingTaskIds.has(task.id))
      .map((task) => {
        const due = this.due.calculate(
          mapTask(task),
          hoursAtApplication,
          cyclesAtApplication,
          performedAt,
        );

        return {
          organizationId,
          aircraftId,
          taskId: task.id,
          componentId: null,
          performedById: resolvedPerformedById,
          inspectedById: null,
          performedAt,
          aircraftHoursAtCompliance: hoursAtApplication,
          aircraftCyclesAtCompliance: cyclesAtApplication,
          nextDueHours: due.nextDueHours,
          nextDueCycles: due.nextDueCycles,
          nextDueDate: due.nextDueDate,
          workOrderNumber: null,
          applicationType: 'baseline' as const,
          isInitial: true,
          status: 'COMPLETED' as const,
          deferralReference: null,
          deferralExpiresAt: null,
          notes: BASELINE_NOTE,
        };
      });

    if (rows.length === 0) return 0;

    await prisma.compliance.createMany({ data: rows });
    return rows.length;
  }

  static async ensureBaselineForTask(
    aircraftId: string,
    taskId: string,
    organizationId: string,
    performedById?: string,
  ): Promise<boolean> {
    const resolvedPerformedById = await this.resolvePerformedById(organizationId, performedById);
    if (!resolvedPerformedById) return false;

    const [aircraft, task, existing] = await Promise.all([
      prisma.aircraft.findFirst({
        where: { id: aircraftId, organizationId },
        select: { id: true, createdAt: true, totalFlightHours: true, totalCycles: true },
      }),
      prisma.maintenanceTask.findFirst({
        where: { id: taskId, organizationId, isActive: true },
        select: {
          id: true,
          organizationId: true,
          code: true,
          title: true,
          description: true,
          intervalType: true,
          intervalHours: true,
          intervalCycles: true,
          intervalCalendarDays: true,
          intervalCalendarMonths: true,
          toleranceHours: true,
          toleranceCycles: true,
          toleranceCalendarDays: true,
          referenceNumber: true,
          referenceType: true,
          isMandatory: true,
          estimatedManHours: true,
          requiresInspection: true,
          applicableModel: true,
          applicablePartNumber: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.compliance.findFirst({
        where: {
          organizationId,
          aircraftId,
          taskId,
          OR: [
            { applicationType: 'baseline' },
            { notes: BASELINE_NOTE },
          ],
        },
        select: { id: true },
      }),
    ]);

    if (!aircraft || !task || existing) return false;

    const hoursAtApplication = Number(aircraft.totalFlightHours);
    const cyclesAtApplication = aircraft.totalCycles;
    const performedAt = aircraft.createdAt;

    const due = this.due.calculate(
      mapTask(task),
      hoursAtApplication,
      cyclesAtApplication,
      performedAt,
    );

    await prisma.compliance.create({
      data: {
        organizationId,
        aircraftId,
        taskId,
        componentId: null,
        performedById: resolvedPerformedById,
        inspectedById: null,
        performedAt,
        aircraftHoursAtCompliance: hoursAtApplication,
        aircraftCyclesAtCompliance: cyclesAtApplication,
        nextDueHours: due.nextDueHours,
        nextDueCycles: due.nextDueCycles,
        nextDueDate: due.nextDueDate,
        workOrderNumber: null,
        applicationType: 'baseline',
        isInitial: true,
        status: 'COMPLETED',
        deferralReference: null,
        deferralExpiresAt: null,
        notes: BASELINE_NOTE,
      },
    });

    return true;
  }

  /**
   * Re-ancla las líneas base que quedaron con un valor de horas anterior a la
   * realidad de la aeronave.
   *
   * Pasa cuando se asigna una plantilla a un avión recién creado (línea base
   * anclada en 0) y recién después se carga su historial de horas: las tareas
   * quedan venciendo contra un origen que nunca existió y el plan entero
   * aparece vencido.
   *
   * La condición es estricta a propósito: solo se re-ancla si, EN LA PROPIA
   * FECHA de la línea base, la aeronave ya acumulaba más horas de las que se
   * registraron. Eso únicamente ocurre con historial cargado hacia atrás. Un
   * vuelo normal registrado después de la línea base no la toca — si lo
   * hiciera, las tareas no vencerían nunca.
   */
  static async reanchorStaleBaselines(
    aircraftId: string,
    organizationId: string,
  ): Promise<number> {
    const aircraft = await prisma.aircraft.findFirst({
      where: { id: aircraftId, organizationId },
      select: { totalFlightHours: true, totalCycles: true },
    });
    if (!aircraft) return 0;

    const currentHours = Number(aircraft.totalFlightHours);
    const currentCycles = aircraft.totalCycles;

    const baselines = await prisma.compliance.findMany({
      where: {
        organizationId,
        aircraftId,
        OR: [{ applicationType: 'baseline' }, { notes: BASELINE_NOTE }],
      },
      include: { task: true },
    });
    if (baselines.length === 0) return 0;

    let reanchored = 0;
    for (const baseline of baselines) {
      const anchoredHours = Number(baseline.aircraftHoursAtCompliance);
      if (anchoredHours >= currentHours) continue;

      // Horas reales que la aeronave acumulaba en la fecha de la línea base.
      const atBaselineDate = await prisma.aircraftUsageLog.findFirst({
        where: { aircraftId, date: { lte: baseline.performedAt } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        select: { totalHours: true, totalCycles: true },
      });
      if (!atBaselineDate) continue;

      const realHoursThen = Number(atBaselineDate.totalHours);
      if (realHoursThen <= anchoredHours) continue; // ancla coherente, no se toca

      const t = baseline.task;
      const due = this.due.calculate(mapTask(t), currentHours, currentCycles, baseline.performedAt);

      await prisma.compliance.update({
        where: { id: baseline.id },
        data: {
          aircraftHoursAtCompliance: currentHours,
          aircraftCyclesAtCompliance: currentCycles,
          nextDueHours: due.nextDueHours,
          nextDueCycles: due.nextDueCycles,
          nextDueDate: due.nextDueDate,
        },
      });
      reanchored += 1;
    }

    return reanchored;
  }
}
